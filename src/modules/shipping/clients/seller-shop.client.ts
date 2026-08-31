// Resolve shop scope và địa chỉ lấy hàng mặc định từ Seller Service.

import { BadGatewayException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CurrentSellerContext } from "../types/shipping.types";

interface SellerProfileResponse {
  shop?: { id?: string };
}

export interface SellerPickupAddressResponse {
  id: string;
  contactName: string;
  phone: string;
  ghnProvinceId: number | null;
  ghnProvinceName: string | null;
  ghnDistrictId: number | null;
  ghnDistrictName: string | null;
  ghnWardCode: string | null;
  ghnWardName: string | null;
  addressLine: string;
}

@Injectable()
export class SellerShopClient {
  private readonly targetBase: string;
  private readonly internalToken: string;

  // Đọc URL và shared token một lần khi service khởi tạo.
  constructor(config: ConfigService) {
    this.targetBase = config.get<string>("SELLER_SERVICE_URL", "http://localhost:3007");
    this.internalToken = config.get<string>("INTERNAL_SERVICE_TOKEN", "dev-media-auth-internal-secret");
  }

  // Resolve shop từ user context, không nhận shopId do browser truyền lên.
  async getOwnedShopId(currentUser: CurrentSellerContext): Promise<string> {
    const profile = await this.request<SellerProfileResponse>(
      "/api/v1/seller/shop/profile",
      {
        "x-user-id": currentUser.userId,
        "x-user-email": currentUser.email,
        "x-user-permissions": currentUser.permissions.join(","),
      },
    );
    const shopId = profile.shop?.id;
    if (!shopId) throw new NotFoundException("Không tìm thấy shop của tài khoản hiện tại.");
    return shopId;
  }

  // Lấy địa chỉ mặc định sau khi Seller Service đã tự kiểm tra scope shop.
  async getDefaultPickupAddress(shopId: string): Promise<SellerPickupAddressResponse> {
    return this.request<SellerPickupAddressResponse>(
      `/api/v1/internal/seller/shops/${encodeURIComponent(shopId)}/pickup-address`,
      { "x-internal-service-token": this.internalToken },
    );
  }

  // Chuẩn hóa lỗi upstream để caller không lộ hostname hoặc credential nội bộ.
  private async request<T>(path: string, headers: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.targetBase}${path}`, {
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BadGatewayException("Seller Service chưa sẵn sàng.");
    }
    if ([401, 403, 404].includes(response.status)) {
      throw new NotFoundException("Không tìm thấy dữ liệu shop cần thiết.");
    }
    if (!response.ok) throw new BadGatewayException("Không thể lấy cấu hình shop lúc này.");
    return (await response.json()) as T;
  }
}
