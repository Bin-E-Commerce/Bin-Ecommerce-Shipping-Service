// Adapter hạ tầng quản lý kết nối và gửi message Kafka cho Shipping Service.
// File này không biết nghiệp vụ shipment; nó chỉ bảo vệ boundary Kafka và xử lý lỗi kết nối theo kiểu best-effort.

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

    // Đọc broker từ ConfigService và giữ credential/connection ở server-side.
    constructor(config: ConfigService) {
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

    // Kết nối lúc module khởi động nhưng không chặn REST tracking khi Kafka local chưa chạy.
    async onModuleInit(): Promise<void> {
        try {
            await this.producer.connect();
        } catch (error) {
            this.logger.warn(
                `Kafka producer connect failed (non-fatal): ${String(error)}`,
            );
        }
    }

    // Đóng kết nối khi service dừng để watch mode không giữ handle cũ.
    async onModuleDestroy(): Promise<void> {
        await this.producer.disconnect().catch(() => undefined);
    }

    // Gửi payload JSON theo topic/key; Kafka lỗi chỉ được log để không làm transaction shipment thất bại sau commit.
    async publish<TPayload>(
        topic: string,
        key: string,
        payload: TPayload,
    ): Promise<void> {
        try {
            await this.producer.send({
                topic,
                messages: [{ key, value: JSON.stringify(payload) }],
            });
        } catch (error) {
            this.logger.error(
                `Failed to publish Kafka message topic=${topic} key=${key}: ${String(error)}`,
            );
        }
    }
}
