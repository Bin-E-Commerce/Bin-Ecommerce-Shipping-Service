import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// Outbox giữ integration event của shipment trong cùng database với trạng thái giao hàng.
// Entity này không gửi Kafka trực tiếp; publisher chịu trách nhiệm claim và retry các bản ghi.
@Entity({ name: 'shipment_status_event_outbox' })
@Index('idx_shipment_status_event_outbox_pending', ['status', 'availableAt'])
export class ShipmentStatusEventOutboxEntity {
    @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 250 })
    eventId!: string;

    @Column({ name: 'topic', type: 'varchar', length: 128 })
    topic!: string;

    @Column({ name: 'aggregate_id', type: 'uuid' })
    aggregateId!: string;

    @Column({ name: 'payload', type: 'jsonb' })
    payload!: object;

    @Column({ name: 'status', type: 'varchar', length: 16, default: 'PENDING' })
    status!: 'PENDING' | 'PROCESSING' | 'PUBLISHED';

    @Column({ name: 'attempt_count', type: 'integer', default: 0 })
    attemptCount!: number;

    @Column({
        name: 'available_at',
        type: 'timestamptz',
        default: () => 'now()',
    })
    availableAt!: Date;

    @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
    publishedAt!: Date | null;

    @Column({ name: 'last_error', type: 'text', nullable: true })
    lastError!: string | null;

    @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
    createdAt!: Date;

    @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
    updatedAt!: Date;
}
