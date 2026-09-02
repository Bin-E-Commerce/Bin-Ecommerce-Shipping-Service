// File này cho phép một order/shop có shipment giao đi và shipment hoàn về độc lập.
// Migration giữ dữ liệu cũ bằng cách gắn mọi shipment hiện tại là FORWARD.
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReturnShipments1788010000000 implements MigrationInterface {
  name = "AddReturnShipments1788010000000";

  // Chuyển ràng buộc duy nhất cũ thành unique index theo loại vận đơn.
  // Phải xóa constraint thay vì xóa index trực tiếp vì PostgreSQL sở hữu index đó
  // thông qua constraint và sẽ từ chối thao tác DROP INDEX.
  // Dữ liệu hiện tại đã unique theo order/shop nên việc tạo index mới vẫn an toàn.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shipment_kind" varchar(16) NOT NULL DEFAULT 'FORWARD'`);
    await queryRunner.query(`ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "return_request_id" uuid`);
    await queryRunner.query(`ALTER TABLE "shipments" DROP CONSTRAINT IF EXISTS "uq_shipments_order_shop"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_shipments_order_shop_kind" ON "shipments" ("order_id", "shop_id", "shipment_kind")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_shipments_return_request" ON "shipments" ("return_request_id") WHERE "return_request_id" IS NOT NULL`);
  }

  // Khôi phục schema cũ theo đúng dạng UNIQUE CONSTRAINT để rollback không làm
  // thay đổi semantics hoặc để lại một index không còn được constraint quản lý.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_shipments_return_request"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_shipments_order_shop_kind"`);
    await queryRunner.query(`ALTER TABLE "shipments" ADD CONSTRAINT "uq_shipments_order_shop" UNIQUE ("order_id", "shop_id")`);
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "return_request_id"`);
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "shipment_kind"`);
  }
}
