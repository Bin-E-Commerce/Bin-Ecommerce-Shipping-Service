// Nhận callback JSON từ GHN và chuyển cho state machine idempotent của Shipping Service.

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ShippingService } from "../services/shipping.service";

@Controller("internal/webhooks/ghn")
export class GhnWebhookController {
  constructor(private readonly shippingService: ShippingService) {}

  // GHN yêu cầu response 200; service ghi event trước khi trả kết quả.
  @Post()
  @HttpCode(200)
  async receive(@Body() body: Record<string, unknown>) {
    await this.shippingService.handleWebhook(body);
    return { received: true };
  }
}
