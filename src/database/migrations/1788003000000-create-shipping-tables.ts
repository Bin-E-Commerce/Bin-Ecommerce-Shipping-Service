// Tạo schema shipment canonical cho GHN Test trên database mới.

import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateShippingTables1788003000000 implements MigrationInterface {
  name = "CreateShippingTables1788003000000";

  // Tạo enum, shipment snapshot và append-only provider events với unique guard idempotency.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE TYPE "shipment_status_enum" AS ENUM ('READY_TO_SHIP','PICKUP_ASSIGNED','PICKED_UP','IN_TRANSIT','DELIVERED','FAILED','CANCELLED','RETURNING','RETURNED')`);
    await queryRunner.query(`
      CREATE TABLE "shipments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "order_number" varchar(64) NOT NULL,
        "shop_id" uuid NOT NULL,
        "seller_user_id" uuid NOT NULL,
        "customer_user_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL DEFAULT 'GHN_TEST',
        "provider_order_reference" varchar(250) NOT NULL,
        "provider_tracking_id" varchar(128) NOT NULL,
        "provider_status_code" integer,
        "provider_status_text" varchar(255),
        "last_provider_synced_at" timestamptz,
        "pickup_address_snapshot" jsonb NOT NULL,
        "tracking_code" varchar(128) NOT NULL,
        "status" "shipment_status_enum" NOT NULL,
        "current_latitude" numeric(10,7) NOT NULL,
        "current_longitude" numeric(10,7) NOT NULL,
        "current_location_label" varchar(180) NOT NULL,
        "route_points" jsonb NOT NULL,
        "estimated_delivery_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_shipments_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_shipments_tracking" UNIQUE ("provider", "tracking_code"),
        CONSTRAINT "uq_shipments_tracking_code" UNIQUE ("tracking_code"),
        CONSTRAINT "uq_shipments_provider_tracking_id" UNIQUE ("provider_tracking_id"),
        CONSTRAINT "uq_shipments_order_shop" UNIQUE ("order_id", "shop_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_shipments_shop_created_at" ON "shipments" ("shop_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "idx_shipments_order_id" ON "shipments" ("order_id")`);
    await queryRunner.query(`
      CREATE TABLE "shipment_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shipment_id" uuid NOT NULL,
        "provider_event_key" varchar(250) NOT NULL,
        "from_status" "shipment_status_enum",
        "to_status" "shipment_status_enum" NOT NULL,
        "reason" varchar(500),
        "latitude" numeric(10,7),
        "longitude" numeric(10,7),
        "location_label" varchar(180),
        "occurred_at" timestamptz NOT NULL,
        "provider_status_code" integer,
        "event_source" varchar(16) NOT NULL DEFAULT 'SYSTEM',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_shipment_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_shipment_events_provider_key" UNIQUE ("provider_event_key"),
        CONSTRAINT "fk_shipment_events_shipment" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_shipment_events_shipment_occurred" ON "shipment_events" ("shipment_id", "occurred_at")`);
  }

  // Xóa schema shipment trong môi trường disposable.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shipment_events"`);
    await queryRunner.query(`DROP TABLE "shipments"`);
    await queryRunner.query(`DROP TYPE "shipment_status_enum"`);
  }
}
