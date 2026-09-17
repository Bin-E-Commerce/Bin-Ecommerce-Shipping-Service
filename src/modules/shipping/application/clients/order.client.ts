//
// File này lấy shipping context từ Order Service qua internal contract.
// Shipping Service không truy cập database Order và không tự suy đoán ownership.
//

import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReturnShippingOrderContext, ShippingOrderContext } from '../types/shipping.types';

@Injectable()
export class OrderClient {
  private readonly targetBase: string;
  private readonly internalToken: string;

  // Đọc endpoint Order Service và token nội bộ từ environment.
  constructor(config: ConfigService) {
    this.targetBase = config.get<string>('ORDER_SERVICE_URL', 'http://localhost:3011');
    this.internalToken = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
  }

  // Lấy snapshot đã được Order Service giới hạn theo user/shop để tạo shipment Seller.
  async getSellerShippingContext(orderId: string, userId: string, shopId: string): Promise<ShippingOrderContext> {
    return this.request<ShippingOrderContext>(
      `/api/v1/internal/orders/${orderId}/shipping-context`,
      { 'x-user-id': userId, 'x-shop-id': shopId },
    );
  }

  // Báo Order Service hủy order sau khi provider xác nhận hủy vận đơn, đồng thời giải phóng tồn kho reservation.
  async cancelSellerOrder(
    orderId: string,
    userId: string,
    shopId: string,
    reason: string,
  ): Promise<void> {
    await this.request<{ id: string }>(
      `/api/v1/internal/orders/${orderId}/seller-cancel`,
      { 'x-user-id': userId, 'x-shop-id': shopId },
      'POST',
      { reason },
    );
  }

  // Xác nhận customer sở hữu order trước khi trả tracking của tất cả shop trong order.
  async assertCustomerOwnsOrder(orderId: string, ownerId: string): Promise<void> {
    await this.request<{ orderId: string }>(
      `/api/v1/internal/orders/${orderId}/owner-check`,
      { 'x-user-id': ownerId },
    );
  }

  // Lấy snapshot return đã được Order Service duyệt; Shipping Service không tự đọc database order.
  async getReturnShippingContext(returnId: string): Promise<ReturnShippingOrderContext> {
    return this.request<ReturnShippingOrderContext>(
      `/api/v1/internal/orders/returns/${returnId}/shipping-context`,
      {},
    );
  }

  // Báo Order Service chuyển request sang RECEIVED sau khi kiện hoàn đã về shop.
  async markReturnReceived(returnId: string): Promise<void> {
    await this.request<{ id: string }>(
      `/api/v1/internal/orders/${returnId}/return-received`,
      {},
      "POST",
    );
  }

  // Đồng bộ trạng thái request sau khi Shipping Service đã lưu reverse shipment.
  async markReturnInTransit(returnId: string): Promise<void> {
    await this.request<{ id: string }>(
      `/api/v1/internal/orders/${returnId}/return-in-transit`,
      {},
      "POST",
    );
  }

  // Đồng bộ chi phí GHN chiều ngược về Order Service để tính đúng số tiền khách được hoàn.
  async updateReturnShippingCost(returnId: string, amount: string): Promise<void> {
    await this.request<{ id: string }>(
      `/api/v1/internal/orders/returns/${returnId}/return-shipping-cost`,
      {},
      "POST",
      { amount },
    );
  }

  // Chuẩn hóa lỗi HTTP nội bộ để không làm lộ response hoặc hostname của downstream service.
  private async request<T>(path: string, contextHeaders: Record<string, string>, method = "GET", body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.targetBase}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-internal-service-token': this.internalToken,
          ...contextHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
