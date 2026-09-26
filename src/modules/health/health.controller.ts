// File này cung cấp health check nhẹ, không chạm database hoặc provider bên ngoài.

import { Controller, Get } from '@nestjs/common';

// Trả trạng thái process để container orchestration không phụ thuộc vào nghiệp vụ shipment.
@Controller({ path: 'health', version: '1' })
export class HealthController {
    // Health endpoint không có side effect và luôn trả nhanh khi process còn sống.
    @Get()
    check(): { status: string; service: string; port: number } {
        return { status: 'ok', service: 'shipping-service', port: 3012 };
    }
}
