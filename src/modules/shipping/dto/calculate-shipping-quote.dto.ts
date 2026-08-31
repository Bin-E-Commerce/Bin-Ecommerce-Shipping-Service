// DTO quote nội bộ; pickup address luôn được Shipping Service lấy từ Seller Service.

import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";
import { GhnAddressSelectionDto } from "./ghn-address.dto";

export class ShippingDestinationDto {
  @IsString()
  contactName!: string;

  @IsString()
  phone!: string;

  @IsString()
  addressLine!: string;

  @IsString()
  province!: string;

  @IsString()
  district!: string;

  @IsString()
  ward!: string;

  @IsOptional()
  @Type(() => GhnAddressSelectionDto)
  @ValidateNested()
  ghnAddress?: GhnAddressSelectionDto;
}

export class CalculateShippingQuoteDto {
  @IsUUID()
  shopId!: string;

  @Type(() => ShippingDestinationDto)
  @ValidateNested()
  to!: ShippingDestinationDto;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  weightGrams!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  lengthCm!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  widthCm!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  heightCm!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  codAmount!: number;
}
