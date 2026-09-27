import { MigrationInterface, QueryRunner } from 'typeorm';

// Tạo outbox bền vững để trạng thái shipment không bị mất khi Kafka tạm thời lỗi.
export class CreateShipmentStatusEventOutbox1788011000000 implements MigrationInterface {
    name = 'CreateShipmentStatusEventOutbox1788011000000';

    // Lưu event cùng database Shipping; worker có thể tiếp tục gửi sau khi broker phục hồi.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_status_event_outbox" (
        "event_id" varchar(250) PRIMARY KEY,
        "topic" varchar(128) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz NULL,
        "last_error" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_shipment_status_event_outbox_status"
          CHECK ("status" IN ('PENDING', 'PROCESSING', 'PUBLISHED'))
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shipment_status_event_outbox_pending"
      ON "shipment_status_event_outbox" ("status", "available_at")
    `);
    }

    // Xóa riêng bảng outbox khi rollback; shipment data không bị tác động.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP TABLE IF EXISTS "shipment_status_event_outbox"`,
        );
    }
}
