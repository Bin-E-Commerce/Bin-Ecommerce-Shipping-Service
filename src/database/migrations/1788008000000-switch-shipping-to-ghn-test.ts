// Chuyển dữ liệu shipment đang dùng provider cũ sang GHN Test mà không xóa lịch sử vận đơn.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class SwitchShippingToGhnTest1788008000000 implements MigrationInterface {
    name = 'SwitchShippingToGhnTest1788008000000';

    // Chuẩn hóa provider hiện tại và giữ các snapshot shipment đã tạo trước đó.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "shipments" SET "provider" = 'GHN_TEST' WHERE "provider" IS NULL OR "provider" <> 'GHN_TEST'`,
        );
        await queryRunner.query(
            `ALTER TABLE "shipments" ALTER COLUMN "provider" SET DEFAULT 'GHN_TEST'`,
        );
    }

    // Không khôi phục provider cũ vì runtime chỉ hỗ trợ GHN Test.
    async down(): Promise<void> {}
}
