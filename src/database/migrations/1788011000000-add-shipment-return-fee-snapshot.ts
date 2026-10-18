// Lưu phí GHN lấy lúc tạo nhãn nhưng chỉ chốt sang return request khi hãng vận chuyển nhận kiện.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentReturnFeeSnapshot1788011000000 implements MigrationInterface {
    name = 'AddShipmentReturnFeeSnapshot1788011000000';

    // Cột nullable tương thích shipment lịch sử; giá trị chỉ là snapshot provider, chưa phải khoản đã chốt.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shipping_fee" numeric(14,2)`,
        );
    }

    // Không xóa phí đã lưu nếu có vận đơn return đang hoạt động.
    async down(queryRunner: QueryRunner): Promise<void> {
        const [{ count }] = await queryRunner.query(
            `SELECT COUNT(*)::int AS count FROM "shipments" WHERE "shipment_kind" = 'RETURN' AND "shipping_fee" IS NOT NULL`,
        );
        if (Number(count) > 0)
            throw new Error(
                'Không thể rollback khi còn snapshot phí vận chuyển hoàn.',
            );
        await queryRunner.query(
            `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "shipping_fee"`,
        );
    }
}
