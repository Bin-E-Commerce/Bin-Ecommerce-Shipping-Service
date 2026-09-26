// DTO cho mapping địa chỉ hiện hành sang bộ mã địa chỉ GHN.

import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class GhnAddressSelectionDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    provinceId!: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    districtId!: number;

    @IsString()
    @MinLength(1)
    wardCode!: string;

    @IsString()
    @MinLength(1)
    districtName!: string;

    @IsString()
    @MinLength(1)
    wardName!: string;
}
