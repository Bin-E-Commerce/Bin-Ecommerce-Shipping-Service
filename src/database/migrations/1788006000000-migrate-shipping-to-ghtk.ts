// Chuyển schema shipment cũ sang provider test và loại bỏ dữ liệu mô phỏng.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateShippingToGhtk1788006000000 implements MigrationInterface {
    name = 'MigrateShippingToGhtk1788006000000';

    // Backfill mã tham chiếu từ dữ liệu cũ trước khi khóa các cột mới là NOT NULL.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TYPE "shipment_status_enum" ADD VALUE IF NOT EXISTS 'RETURNING'`,
        );
        await queryRunner.query(
            `ALTER TYPE "shipment_status_enum" ADD VALUE IF NOT EXISTS 'RETURNED'`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "provider_order_reference" varchar(250)`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "provider_tracking_id" varchar(128)`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "provider_status_code" integer`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "provider_status_text" varchar(255)`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "last_provider_synced_at" timestamptz`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "pickup_address_snapshot" jsonb`,
        );
        await queryRunner.query(
            `UPDATE "shipments" SET "provider_order_reference" = CONCAT('BIN-', "order_id"::text, '-', "shop_id"::text) WHERE "provider_order_reference" IS NULL`,
        );
        await queryRunner.query(
            `UPDATE "shipments" SET "provider_tracking_id" = "tracking_code" WHERE "provider_tracking_id" IS NULL`,
        );
        await queryRunner.query(
            `UPDATE "shipments" SET "pickup_address_snapshot" = '{}'::jsonb WHERE "pickup_address_snapshot" IS NULL`,
        );
        await queryRunner.query(
            `UPDATE "shipments" SET "provider" = 'GHN_TEST'`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "provider_order_reference" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "provider_tracking_id" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "pickup_address_snapshot" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "provider" SET DEFAULT 'GHN_TEST'`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "tracking_code" TYPE varchar(128)`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "estimated_delivery_at" DROP NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "auto_simulation_enabled"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "next_auto_advance_at"`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "uq_shipments_provider_tracking_id" ON "shipments" ("provider_tracking_id")`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "uq_shipments_tracking_code" ON "shipments" ("tracking_code")`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipment_events" ADD COLUMN IF NOT EXISTS "provider_status_code" integer`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipment_events" ADD COLUMN IF NOT EXISTS "event_source" varchar(16) NOT NULL DEFAULT 'SYSTEM'`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipment_events" ALTER COLUMN "provider_event_key" TYPE varchar(250)`,
        );
    }

    // Giữ migration down an toàn cho môi trường disposable; dữ liệu cũ không được khôi phục tự động.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "shipment_events" DROP COLUMN IF EXISTS "event_source"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipment_events" DROP COLUMN IF EXISTS "provider_status_code"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "uq_shipments_provider_tracking_id"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "uq_shipments_tracking_code"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "pickup_address_snapshot"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "last_provider_synced_at"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "provider_status_text"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "provider_status_code"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "provider_tracking_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "provider_order_reference"`,
        );
    }
}
