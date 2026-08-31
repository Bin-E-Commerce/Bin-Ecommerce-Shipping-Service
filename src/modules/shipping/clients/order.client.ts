//
// File này lấy shipping context từ Order Service qua internal contract.
// Shipping Service không truy cập database Order và không tự suy đoán ownership.
//

import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ShippingOrderContext } from '../types/shipping.types';

@Injectable()
export class OrderClient {
  private readonly targetBase: string;
  private readonly internalToken: string;

  // Đọc endpoint Order Service và token nội bộ từ environment.
  constructor(config: ConfigService) {
    this.targetBase = config.get<string>('ORDER_SERVICE_URL', 'http://localhost:3011');
    this.internalToken = config.get<string>('INTERNAL_SERVICE_TOKEN', 'dev-media-auth-internal-secret');
  }

  // Lấy snapshot đã được Order Service giới hạn theo user/shop để tạo shipment Seller.
  async getSellerShippingContext(orderId: string, userId: string, shopId: string): Promise<ShippingOrderContext> {
    return this.request<ShippingOrderContext>(
      `/api/v1/internal/orders/${orderId}/shipping-context`,
      { 'x-user-id': userId, 'x-shop-id': shopId },
    );
  }

  // Xác nhận customer sở hữu order trước khi trả tracking của tất cả shop trong order.
  async assertCustomerOwnsOrder(orderId: string, ownerId: string): Promise<void> {
    await this.request<{ orderId: string }>(
      `/api/v1/internal/orders/${orderId}/owner-check`,
      { 'x-user-id': ownerId },
    );
  }

  // Chuẩn hóa lỗi HTTP nội bộ để không làm lộ response hoặc hostname của downstream service.
  private async request<T>(path: string, contextHeaders: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.targetBase}${path}`, {
        headers: {
          accept: 'application/json',
          'x-internal-service-token': this.internalToken,
          ...contextHeaders,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BadGatewayException('Order Service chưa sẵn sàng. Vui lòng thử lại sau.');
    }

    if (response.status === 404) throw new NotFoundException('Không tìm thấy đơn hàng trong phạm vi tài khoản.');
    if (!response.ok) throw new BadGatewayException('Không thể lấy dữ liệu đơn hàng lúc này.');
    return (await response.json()) as T;
  }
}
