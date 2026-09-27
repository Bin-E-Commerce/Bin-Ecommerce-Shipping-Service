// Adapter hạ tầng quản lý kết nối và gửi message Kafka cho Shipping Service.
// File này không biết nghiệp vụ shipment; outbox mới chịu trách nhiệm giữ và retry event.

import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

// Đóng gói Kafka producer để các publisher nghiệp vụ không phụ thuộc trực tiếp vào kafkajs.
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(KafkaProducerService.name);
    private readonly producer: Producer;
    private readonly publishTimeoutMs: number;
    private connected = false;
    private connecting?: Promise<void>;

    // Đọc broker từ ConfigService và giữ credential/connection ở server-side.
    constructor(config: ConfigService) {
        const configuredTimeout = Number(
            config.get<string>('KAFKA_PUBLISH_TIMEOUT_MS', '10000'),
        );
        this.publishTimeoutMs =
            Number.isFinite(configuredTimeout) && configuredTimeout > 0
                ? configuredTimeout
                : 10000;

        const kafka = new Kafka({
            clientId: config.get<string>('KAFKA_CLIENT_ID', 'shipping-service'),
            brokers: config
                .get<string>('KAFKA_BROKERS', 'localhost:29092')
                .split(',')
                .map((broker) => broker.trim()),
            retry: { retries: 3 },
        });
        this.producer = kafka.producer();
    }

    // Thử kết nối lúc khởi động nhưng không chặn REST tracking; mỗi lần gửi sẽ tự kết nối lại nếu broker vừa phục hồi.
    async onModuleInit(): Promise<void> {
        try {
            await this.ensureConnected();
            this.logger.log('Kafka producer connected');
        } catch (error) {
            this.logger.warn(
                `Kafka producer connect failed (non-fatal): ${String(error)}`,
            );
        }
    }

    // Đóng kết nối khi service dừng để watch mode không giữ handle cũ.
    async onModuleDestroy(): Promise<void> {
        this.connected = false;
        await this.producer.disconnect().catch(() => undefined);
    }

    // Kết nối một lần cho nhiều request; promise dùng chung để tránh nhiều transition cùng gọi connect đồng thời.
    private async ensureConnected(): Promise<void> {
        if (this.connected) return;
        if (!this.connecting) {
            this.connecting = this.producer
                .connect()
                .then(() => {
                    this.connected = true;
                })
                .finally(() => {
                    this.connecting = undefined;
                });
        }
        await this.connecting;
    }

    // Giới hạn thời gian chờ để outbox nhanh chóng trả event về PENDING thay vì bị kẹt PROCESSING.
    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
    ): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new Error(`Kafka publish timeout after ${timeoutMs}ms`),
                    ),
                timeoutMs,
            );
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // Trả boolean thay vì nuốt lỗi; outbox dùng kết quả này để quyết định PUBLISHED hay retry.
    async publish<TPayload>(
        topic: string,
        key: string,
        payload: TPayload,
    ): Promise<boolean> {
        try {
            await this.withTimeout(
                (async () => {
                    await this.ensureConnected();
                    await this.producer.send({
                        topic,
                        messages: [{ key, value: JSON.stringify(payload) }],
                    });
                })(),
                this.publishTimeoutMs,
            );
            return true;
        } catch (error) {
            this.connected = false;
            this.logger.error(
                `Failed to publish Kafka message topic=${topic} key=${key}: ${String(error)}`,
            );
            return false;
        }
    }
}
