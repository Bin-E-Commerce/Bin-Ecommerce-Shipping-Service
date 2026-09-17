// Internal API cho Order orchestration và worker đồng bộ GHN.

import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CalculateShippingQuoteDto } from "../dto/calculate-shipping-quote.dto";
import { ShippingService } from "../../application/services/shipping.service";

@Controller({ path: "internal/shipments", version: "1" })
export class InternalShipmentController {
  constructor(
    private readonly shippingService: ShippingService,
    private readonly config: ConfigService,
  ) {}

  // Lấy shipment nội bộ sau khi xác thực shared token.
  @Get(":shipmentId")
  get(@Param("shipmentId", new ParseUUIDPipe()) shipmentId: string, @Headers("x-internal-service-token") token: string) {
    this.assertToken(token);
    return this.shippingService.getInternal(shipmentId);
  }

  // Quote server-side: pickup address do Shipping Service lấy từ Seller Service.
  @Post("quotes")
  quote(@Body() dto: CalculateShippingQuoteDto, @Headers("x-internal-service-token") token: string) {
    this.assertToken(token);
    return this.shippingService.calculateQuote(dto);
  }

  // Worker dùng route này để đồng bộ provider khi webhook chưa về.
  @Post(":shipmentId/sync")
  sync(@Param("shipmentId", new ParseUUIDPipe()) shipmentId: string, @Headers("x-internal-service-token") token: string) {
    this.assertToken(token);
    return this.shippingService.syncInternal(shipmentId);
  }

  // Hủy provider trước khi cập nhật canonical state local.
  @Post(":shipmentId/cancel")
  cancel(@Param("shipmentId", new ParseUUIDPipe()) shipmentId: string, @Headers("x-internal-service-token") token: string) {
    this.assertToken(token);
    return this.shippingService.cancelInternal(shipmentId);
  }

  // Chặn request không có shared secret tại service dù Gateway đã bảo vệ route.
  private assertToken(token: string): void {
    const expected = this.config.get<string>("INTERNAL_SERVICE_TOKEN", "");
    if (!expected || token !== expected) throw new UnauthorizedException("Invalid internal service token.");
  }
}
