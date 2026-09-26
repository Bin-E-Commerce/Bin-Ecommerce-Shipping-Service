import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Lý do Seller hủy vận đơn là bắt buộc để Customer và lịch sử đơn biết nguyên nhân rõ ràng.
export class CancelShipmentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    reason!: string;
}
