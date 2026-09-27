// Publisher chuyển shipment event thành integration event và quản lý durable outbox.
// File này không thay đổi state machine; nó chỉ bảo đảm event đã commit được retry đến Kafka.

import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Shipment } from '@/database/entities/shipment.entity';
import { ShipmentEvent } from '@/database/entities/shipment-event.entity';
import { ShipmentStatusEventOutboxEntity } from '@/database/entities/shipment-status-event-outbox.entity';
import { KafkaProducerService } from '@/kafka/kafka-producer.service';

export const SHIPMENT_STATUS_UPDATED = 'shipment.status.updated';

type OutboxRow = {
    event_id: string;
    topic: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    attempt_count: number;
};

// Đóng gói shipment event, ghi outbox trong transaction và dispatch theo thứ tự tạo.
@Injectable()
export class ShipmentEventsPublisher implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ShipmentEventsPublisher.name);
    private dispatchTimer?: NodeJS.Timeout;
    private dispatching = false;

    constructor(
        private readonly kafkaProducer: KafkaProducerService,
        @InjectRepository(ShipmentStatusEventOutboxEntity)
        private readonly outboxRepository: Repository<ShipmentStatusEventOutboxEntity>,
    ) {}

    // Khởi động worker nền để event lỗi vẫn được gửi lại sau khi Kafka phục hồi.
    onModuleInit(): void {
        this.dispatchTimer = setInterval(
            () => void this.dispatchPendingSafe(),
            5000,
        );
        void this.dispatchPendingSafe();
    }

    // Dừng polling khi Nest shutdown để không giữ timer trong watch mode hoặc test.
    onModuleDestroy(): void {
        if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    }

    // Ghi event vào outbox bằng EntityManager hiện tại để shipment, history và integration event commit cùng nhau.
    async enqueue(
        shipment: Shipment,
        event: ShipmentEvent,
        manager: EntityManager,
    ): Promise<void> {
        const payload = this.toPayload(shipment, event);
        await manager
            .getRepository(ShipmentStatusEventOutboxEntity)
            .createQueryBuilder()
            .insert()
            .into(ShipmentStatusEventOutboxEntity)
            .values({
                eventId: event.providerEventKey,
                topic: SHIPMENT_STATUS_UPDATED,
                aggregateId: shipment.id,
                payload,
                status: 'PENDING',
                availableAt: new Date(),
                updatedAt: new Date(),
            })
            .orIgnore()
            .execute();
    }

    // Kích hoạt dispatch sau commit; dữ liệu đã được enqueue atomically trong transaction nghiệp vụ.
    async publish(_shipment: Shipment, _event: ShipmentEvent): Promise<void> {
        await this.dispatchPendingSafe();
    }

    // Claim một batch bằng SKIP LOCKED để nhiều instance không gửi trùng cùng một outbox row.
    private async dispatchPending(): Promise<void> {
        await this.outboxRepository.query(
            `UPDATE shipment_status_event_outbox
          SET status = 'PENDING', updated_at = now()
        WHERE status = 'PROCESSING' AND updated_at < now() - INTERVAL '1 minute'`,
        );

        const [rows] = (await this.outboxRepository.query(
            `WITH claimed AS (
         SELECT event_id
           FROM shipment_status_event_outbox
          WHERE status = 'PENDING' AND available_at <= now()
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED LIMIT 20
       )
       UPDATE shipment_status_event_outbox outbox
          SET status = 'PROCESSING', updated_at = now()
         FROM claimed
        WHERE outbox.event_id = claimed.event_id
      RETURNING outbox.event_id AS event_id,
                outbox.topic AS topic,
                outbox.aggregate_id AS aggregate_id,
                outbox.payload AS payload,
                outbox.attempt_count AS attempt_count`,
        )) as [OutboxRow[], number];

        for (const row of rows) {
            const published = await this.kafkaProducer.publish(
                row.topic,
                row.aggregate_id,
                row.payload,
            );
            if (published) {
                await this.outboxRepository.update(
                    { eventId: row.event_id },
                    {
                        status: 'PUBLISHED',
                        publishedAt: new Date(),
                        lastError: null,
                        updatedAt: new Date(),
                    },
                );
                continue;
            }

            const attemptCount = row.attempt_count + 1;
            const delaySeconds = Math.min(
                3600,
                2 ** Math.min(attemptCount, 10),
            );
            await this.outboxRepository.update(
                { eventId: row.event_id },
                {
                    status: 'PENDING',
                    attemptCount,
                    availableAt: new Date(Date.now() + delaySeconds * 1000),
                    lastError: 'Kafka publish failed; event will be retried.',
                    updatedAt: new Date(),
                },
            );
        }
    }

    // Chặn nhiều vòng polling chồng nhau và không để lỗi hạ tầng tạo unhandled rejection.
    private async dispatchPendingSafe(): Promise<void> {
        if (this.dispatching) return;
        this.dispatching = true;
        try {
            await this.dispatchPending();
        } catch (error) {
            this.logger.warn(
                `Shipment event outbox deferred: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            this.dispatching = false;
        }
    }

    // Tạo snapshot payload độc lập với entity để downstream không phải truy cập ngược Shipping database.
    private toPayload(shipment: Shipment, event: ShipmentEvent): object {
        return {
            eventId: event.providerEventKey,
            eventName: SHIPMENT_STATUS_UPDATED,
            eventVersion: 1,
            source: 'shipping-service',
            aggregateId: shipment.id,
            occurredAt: event.occurredAt.toISOString(),
            data: {
                shipmentId: shipment.id,
                orderId: shipment.orderId,
                shipmentKind: shipment.shipmentKind,
                returnRequestId: shipment.returnRequestId,
                orderNumber: shipment.orderNumber,
                shopId: shipment.shopId,
                statusLabel: this.statusLabel(event.toStatus),
                sellerUserId: shipment.sellerUserId,
                customerUserId: shipment.customerUserId,
                trackingCode: shipment.providerTrackingId,
                status: event.toStatus,
                providerStatusCode: event.providerStatusCode,
                currentLocation: {
                    latitude: Number(shipment.currentLatitude),
                    longitude: Number(shipment.currentLongitude),
                    label: event.locationLabel ?? shipment.currentLocationLabel,
                },
            },
        };
    }

    // Notification Service cần label ổn định và không phụ thuộc enum nội bộ của Shipping Service.
    private statusLabel(status: string): string {
        const labels: Record<string, string> = {
            READY_TO_SHIP: 'Shop đang chuẩn bị hàng',
            PICKUP_ASSIGNED: 'Đã phân công lấy hàng',
            PICKED_UP: 'Đơn vị vận chuyển đã lấy hàng',
            IN_TRANSIT: 'Đang trên đường giao',
            DELIVERED: 'Giao hàng thành công',
            FAILED: 'Giao hàng thất bại',
            CANCELLED: 'Vận đơn đã hủy',
            RETURNING: 'Đang hoàn hàng',
            RETURNED: 'Đã hoàn hàng',
        };
        return labels[status] ?? 'Có cập nhật mới';
    }
}
