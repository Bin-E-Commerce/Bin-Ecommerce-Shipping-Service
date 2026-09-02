// Public Seller shipment actions: tạo, làm mới, hủy đủ điều kiện và in nhãn GHN Test.

import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { CurrentSellerContext } from "../types/shipping.types";
import { ShippingService } from "../services/shipping.service";
import { CancelShipmentDto } from "../dto/cancel-shipment.dto";

@ApiTags("seller-shipments")
@ApiBearerAuth()
@Controller({ path: "seller/orders", version: "1" })
export class SellerShipmentController {
  constructor(private readonly shippingService: ShippingService) {}

  // Tạo shipment theo shop được resolve từ user context.
  @Post(":orderId/shipment")
  create(@Param("orderId", new ParseUUIDPipe()) orderId: string, @Headers() headers: Record<string, unknown>) {
    return this.shippingService.createForSeller(orderId, this.buildContext(headers));
  }

  // Đọc shipment của shop hiện tại trong order.
  @Get(":orderId/shipment")
  get(@Param("orderId", new ParseUUIDPipe()) orderId: string, @Headers() headers: Record<string, unknown>) {
    return this.shippingService.getForSeller(orderId, this.buildContext(headers));
  }

  // Làm mới từ tracking GHN, không tự đẩy trạng thái.
  @Post(":orderId/shipment/refresh")
  refresh(@Param("orderId", new ParseUUIDPipe()) orderId: string, @Headers() headers: Record<string, unknown>) {
    return this.shippingService.refreshForSeller(orderId, this.buildContext(headers));
  }

  // Hủy qua GHN chỉ khi carrier chưa lấy hàng.
  @Post(":orderId/shipment/cancel")
  cancel(
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() dto: CancelShipmentDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.shippingService.cancelForSeller(
      orderId,
      this.buildContext(headers),
      dto.reason,
    );
  }

  // Seller tạo vận đơn hoàn sau khi request đã được duyệt; service scope bằng seller session.
  @Post("returns/:returnId/shipment")
  createReturn(
    @Param("returnId", new ParseUUIDPipe()) returnId: string,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.shippingService.createReturnForSeller(returnId, this.buildContext(headers));
  }

  // Bỏ qua một chặng để trình diễn lộ trình trong môi trường GHN Test.
  @Post(":orderId/shipment/demo/advance")
  advanceDemo(@Param("orderId", new ParseUUIDPipe()) orderId: string, @Headers() headers: Record<string, unknown>) {
    return this.shippingService.advanceDemoForSeller(orderId, this.buildContext(headers));
  }

  // Gửi binary nhãn GHN trực tiếp để Nest không serialize Buffer thành JSON.
  @Get(":orderId/shipment/label")
  async label(
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Headers() headers: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const shipment = await this.shippingService.getSellerShipmentEntity(orderId, this.buildContext(headers));
    const label = await this.shippingService.printLabel(shipment.id);
    response
      .setHeader("Content-Type", label.contentType)
      .setHeader("Content-Disposition", `attachment; filename="${shipment.trackingCode}.${label.fileExtension}"`)
      .send(label.content);
  }

  // Chuẩn hóa header context, không nhận shopId từ browser.
  private buildContext(headers: Record<string, unknown>): CurrentSellerContext {
    return {
      userId: this.header(headers, "x-user-id"),
      email: this.header(headers, "x-user-email"),
      permissions: this.header(headers, "x-user-permissions").split(",").map((value) => value.trim()).filter(Boolean),
    };
  }

  // Đọc header an toàn trong cả Express string và string[].
  private header(headers: Record<string, unknown>, key: string): string {
    const value = headers[key];
    return Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "";
  }
}
