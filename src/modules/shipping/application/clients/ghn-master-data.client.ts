// Client master data GHN; cache và chống request trùng được sở hữu bởi Shipping Service.

import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { GhnDistrictOption, GhnProvinceOption, GhnWardOption } from "../types/shipping.types";

type UnknownRecord = Record<string, unknown>;

@Injectable()
export class GhnMasterDataClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly ttlMs = 60 * 60 * 1_000;

  // Đọc credential và thời gian timeout dùng chung cho các API master data GHN.
  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("GHN_BASE_URL", "https://dev-online-gateway.ghn.vn").replace(/\/$/, "");
    if (this.baseUrl !== "https://dev-online-gateway.ghn.vn") throw new Error("GHN_BASE_URL phải trỏ tới GHN Test trong phase này.");
    this.token = config.get<string>("GHN_TOKEN", "").trim();
    this.timeoutMs = Math.max(1_000, config.get<number>("GHN_REQUEST_TIMEOUT_MS", 10_000));
  }

  // Tải danh sách tỉnh/thành phố và trả contract tối giản cho frontend.
  async listProvinces(): Promise<GhnProvinceOption[]> {
    const rows = await this.getRows("provinces", "/shiip/public-api/master-data/province");
    return rows
      .map((row) => ({ id: this.number(row.ProvinceID), name: this.string(row.ProvinceName) }))
      .filter((item): item is GhnProvinceOption => item.id !== null && item.id > 0 && item.name !== null);
  }

  // Tải quận/huyện theo mã tỉnh GHN và giữ quan hệ provinceId trong response.
  async listDistricts(provinceId: number): Promise<GhnDistrictOption[]> {
    this.assertId(provinceId, "tỉnh/thành phố");
    const rows = await this.getRows(`districts:${provinceId}`, "/shiip/public-api/master-data/district", { province_id: provinceId });
    return rows
      .map((row) => ({ id: this.number(row.DistrictID), name: this.string(row.DistrictName), provinceId }))
      .filter((item): item is GhnDistrictOption => item.id !== null && item.id > 0 && item.name !== null);
  }

  // Tải phường/xã theo mã quận/huyện GHN.
  async listWards(districtId: number): Promise<GhnWardOption[]> {
    this.assertId(districtId, "quận/huyện");
    const rows = await this.getRows(`wards:${districtId}`, "/shiip/public-api/master-data/ward", { district_id: districtId });
    return rows
      .map((row) => ({ code: this.string(row.WardCode), name: this.string(row.WardName), districtId }))
      .filter((item): item is GhnWardOption => item.code !== null && item.name !== null);
  }

  // Kiểm tra mã địa lý trước khi gọi GHN để lỗi không bị biến thành lỗi upstream khó hiểu.
  private assertId(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 1) throw new BadRequestException(`Mã ${label} GHN không hợp lệ.`);
  }

  // Đọc cache theo TTL và dùng promise đang chạy để deduplicate request đồng thời.
  private async getRows(cacheKey: string, path: string, body?: unknown): Promise<UnknownRecord[]> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as UnknownRecord[];
    if (cached) this.cache.delete(cacheKey);
    const running = this.inFlight.get(cacheKey);
    if (running) return running as Promise<UnknownRecord[]>;

    const request = this.request<UnknownRecord>(path, body === undefined ? "GET" : "POST", body)
      .then((payload) => {
        const rows = Array.isArray(payload.data) ? payload.data.map((item) => this.asRecord(item)) : [];
        this.cache.set(cacheKey, { value: rows, expiresAt: Date.now() + this.ttlMs });
        return rows;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  // Gọi GHN master data và chuyển cả HTTP error lẫn business error thành lỗi an toàn.
  private async request<T extends UnknownRecord>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    if (!this.token) throw new ServiceUnavailableException("GHN Test chưa được cấu hình GHN_TOKEN.");
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { accept: "application/json", "content-type": "application/json", Token: this.token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException("GHN Test hiện không sẵn sàng.");
    }
    const payload = (await response.json().catch(() => ({}))) as T;
    const code = this.number(payload.code);
    if (!response.ok || (code !== null && code !== 200)) throw new BadGatewayException(this.string(payload.message) ?? "GHN từ chối request master data.");
    return payload;
  }

  // Chuẩn hóa record không tin cậy từ response của GHN.
  private asRecord(value: unknown): UnknownRecord { return typeof value === "object" && value !== null ? value as UnknownRecord : {}; }
  private number(value: unknown): number | null { const result = typeof value === "number" ? value : Number(value); return Number.isFinite(result) ? result : null; }
  private string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
}
