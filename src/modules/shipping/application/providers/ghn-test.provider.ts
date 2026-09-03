// Adapter duy nhất gọi GHN Test; credential chỉ được đọc ở Shipping Service.

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ShipmentStatus } from "../../../../database/enums/shipment-status.enum";
import type {
  CreateShipmentInput,
  CreatedShipment,
  GhnAddressSelection,
  PrintedShippingLabel,
  ProviderShipmentStatus,
  RoutePoint,
  ShippingAddress,
  ShippingProvider,
  ShippingQuote,
  ShippingQuoteInput,
} from "../types/shipping.types";
import { GHN_PROVIDER } from "../types/shipping.types";
import { normalizeGhnStatus } from "./ghn-status.mapper";
import { GhnMasterDataClient } from "../clients/ghn-master-data.client";

type UnknownRecord = Record<string, unknown>;

interface GhnAddress {
  provinceId: number;
  districtId: number;
  wardCode: string;
  provinceName: string;
  districtName: string;
  wardName: string;
}
interface GhnNamedAddress {
  id: number;
  name: string;
}

// Adapter GHN Test giữ toàn bộ mapping địa chỉ, phí, vận đơn và nhãn ở server-side.
@Injectable()
export class GhnTestProvider implements ShippingProvider {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly shopIdInput: string;
  private readonly shopId: number | null;
  private readonly timeoutMs: number;
  private readonly serviceTypeId: number;
  private readonly defaultPoint: RoutePoint;
  private readonly demoRoutePoints: RoutePoint[];
  private readonly addressCache = new Map<string, GhnAddress>();

  // Chặn nhầm production để token GHN Test không thể tạo đơn thật trong phase này.
  constructor(
    private readonly config: ConfigService,
    private readonly masterDataClient: GhnMasterDataClient = new GhnMasterDataClient(
      config,
    ),
  ) {
    this.baseUrl = config
      .get<string>("GHN_BASE_URL", "https://dev-online-gateway.ghn.vn")
      .replace(/\/$/, "");
    if (this.baseUrl !== "https://dev-online-gateway.ghn.vn")
      throw new Error("GHN_BASE_URL phải trỏ tới GHN Test trong phase này.");
    this.token = config.get<string>("GHN_TOKEN", "").trim();
    this.shopIdInput = config.get<string>("GHN_SHOP_ID", "").trim();
    const configuredShopId = Number(this.shopIdInput);
    this.shopId =
      Number.isInteger(configuredShopId) && configuredShopId > 0
        ? configuredShopId
        : null;
    this.timeoutMs = Math.max(
      1_000,
      config.get<number>("GHN_REQUEST_TIMEOUT_MS", 10_000),
    );
    this.serviceTypeId = Math.max(
      1,
      config.get<number>("GHN_SERVICE_TYPE_ID", 2),
    );
    this.defaultPoint = {
      latitude: config.get<number>("MAP_DEFAULT_LATITUDE", 10.7769),
      longitude: config.get<number>("MAP_DEFAULT_LONGITUDE", 106.7009),
      label: "Shop · Điểm lấy hàng",
    };
    this.demoRoutePoints = [
      this.defaultPoint,
      {
        latitude: this.defaultPoint.latitude - 0.0038,
        longitude: this.defaultPoint.longitude + 0.0062,
        label: "Trạm GHN · Đã tiếp nhận",
      },
      {
        latitude: this.defaultPoint.latitude - 0.0094,
        longitude: this.defaultPoint.longitude + 0.0028,
        label: "Kho trung chuyển · Đang luân chuyển",
      },
      {
        latitude: this.defaultPoint.latitude - 0.0065,
        longitude: this.defaultPoint.longitude + 0.0138,
        label: "Khu vực giao · Shipper đang giao",
      },
      {
        latitude: this.defaultPoint.latitude - 0.0017,
        longitude: this.defaultPoint.longitude + 0.0182,
        label: "Điểm nhận · Giao thành công",
      },
    ];
  }

  // Cho frontend biết credential platform đã sẵn sàng mà không làm lộ token.
  isConfigured(): boolean {
    return Boolean(this.token && this.shopId);
  }

  // GHN tính phí bằng POST, cân nặng gram và kích thước cm theo từng request.
  async calculateFee(input: ShippingQuoteInput): Promise<ShippingQuote> {
    this.ensureConfigured();
    const [from, to] = await Promise.all([
      this.resolveAddress(input.from),
      this.resolveAddress(input.to),
    ]);
    const payload = await this.requestJson<UnknownRecord>(
      "/shiip/public-api/v2/shipping-order/fee",
      "POST",
      {
        service_type_id: this.serviceTypeId,
        from_district_id: from.districtId,
        from_ward_code: from.wardCode,
        to_district_id: to.districtId,
        to_ward_code: to.wardCode,
        weight: Math.round(input.weightGrams),
        length: Math.round(input.lengthCm),
        width: Math.round(input.widthCm),
        height: Math.round(input.heightCm),
        insurance_value: Math.round(input.value),
        coupon: null,
        items: [],
      },
      true,
    );
    const fee = this.asRecord(payload.data);
    const baseFee = this.money(fee.service_fee ?? fee.main_service);
    const declaredValueFee = this.money(fee.insurance_fee ?? fee.insurance);
    const surchargeEntries = [
      ["PICK_REMOTE", "Phí lấy hàng vùng xa", fee.pick_remote_areas_fee],
      ["DELIVER_REMOTE", "Phí giao hàng vùng xa", fee.deliver_remote_areas_fee],
      ["COD", "Phí thu hộ COD", fee.cod_fee],
      ["R2S", "Phí giao lại", fee.r2s_fee],
      ["DOUBLE_CHECK", "Phí đồng kiểm", fee.double_check],
    ] as const;
    const surcharges = surchargeEntries
      .filter(([, , value]) => (this.numeric(value) ?? 0) > 0)
      .map(([type, title, value]) => ({
        type,
        title,
        amount: this.money(value),
      }));
    const calculatedTotal =
      (this.numeric(baseFee) ?? 0) +
      (this.numeric(declaredValueFee) ?? 0) +
      surcharges.reduce(
        (sum, item) => sum + (this.numeric(item.amount) ?? 0),
        0,
      );
    const total = this.money(fee.total ?? calculatedTotal);
    return {
      provider: GHN_PROVIDER,
      shopId: input.shopId,
      serviceCode: `GHN_SERVICE_${this.serviceTypeId}`,
      serviceName: "GHN Test · Giao tiêu chuẩn",
      fee: total,
      baseFee,
      declaredValueFee,
      surcharges,
      deliverySupported: true,
      estimatedDeliveryAt: null,
    };
  }

  // Tạo đơn gửi cân nặng gram, mã client ổn định và tiền COD chỉ là tiền hàng.
  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    this.ensureConfigured();
    const [from, to] = await Promise.all([
      this.resolveAddress(input.pickupAddress),
      this.resolveAddress(input.shippingAddress),
    ]);
    const packageData = this.packageData(input);
    const providerOrderReference = this.createPartnerReference(
      input.orderNumber,
      input.shopId,
      input.shipmentKind ?? "FORWARD",
    );
    const payload = await this.requestJson<UnknownRecord>(
      "/shiip/public-api/v2/shipping-order/create",
      "POST",
      {
        payment_type_id: input.codAmount > 0 ? 2 : 1,
        note: "Đơn hàng từ BIN E-commerce",
        required_note: "KHONGCHOXEMHANG",
        from_name: input.pickupAddress.contactName,
        from_phone: input.pickupAddress.phone,
        from_address: input.pickupAddress.addressLine,
        from_ward_name: from.wardName,
        from_district_name: from.districtName,
        from_province_name: from.provinceName,
        return_phone: input.pickupAddress.phone,
        return_address: input.pickupAddress.addressLine,
        to_name: input.shippingAddress.contactName,
        to_phone: input.shippingAddress.phone,
        to_address: input.shippingAddress.addressLine,
        to_ward_code: to.wardCode,
        to_district_id: to.districtId,
        client_order_code: providerOrderReference,
        cod_amount: Math.round(input.codAmount),
        content: input.items
          .map((item) => item.productName)
          .join(", ")
          .slice(0, 2_000),
        weight: packageData.weight,
        length: packageData.length,
        width: packageData.width,
        height: packageData.height,
        insurance_value: Math.round(input.value),
        service_id: 0,
        service_type_id: this.serviceTypeId,
        coupon: null,
        items: input.items.map((item) => ({
          name: item.productName,
          code: item.sku,
          quantity: item.quantity,
          price: Math.round(Number(item.unitPrice)),
          length: Math.round(item.packageLengthCm),
          width: Math.round(item.packageWidthCm),
          height: Math.round(item.packageHeightCm),
          weight: Math.round(item.packageWeightGrams),
        })),
      },
      true,
    );
    const order = this.asRecord(payload.data);
    const fee = this.asRecord(order.fee);
    const trackingId = this.text(order.order_code);
    if (!trackingId)
      throw new BadGatewayException("GHN trả về response thiếu mã vận đơn.");
    const statusText = this.text(order.status) ?? "ready_to_pick";
    const normalized = normalizeGhnStatus(statusText, null);
    return {
      providerOrderReference,
      trackingId,
      providerStatusCode: null,
      providerStatusText: statusText,
      status: normalized.canonicalStatus ?? ShipmentStatus.READY_TO_SHIP,
      currentLocation: this.pointForStatus(normalized.canonicalStatus),
      routePoints: this.demoRoutePoints,
      estimatedDeliveryAt: this.date(order.expected_delivery_time),
      shippingFee: this.money(order.total_fee ?? fee.total),
    };
  }

  // Tracking dùng order detail hoặc detail-by-client-code khi đang resolve timeout lúc tạo đơn.
  async getShipment(trackingId: string): Promise<ProviderShipmentStatus> {
    this.ensureConfigured();
    const byClientCode = trackingId.startsWith("BIN-");
    const payload = await this.requestJson<UnknownRecord>(
      byClientCode
        ? "/shiip/public-api/v2/shipping-order/detail-by-client-code"
        : "/shiip/public-api/v2/shipping-order/detail",
      "POST",
      byClientCode
        ? { client_order_code: trackingId }
        : { order_code: trackingId },
    );
    const dataValue = Array.isArray(payload.data)
      ? payload.data[0]
      : payload.data;
    const data = this.asRecord(dataValue);
    const statusText = this.text(data.status) ?? null;
    const normalized = statusText
      ? normalizeGhnStatus(statusText, this.text(data.reason))
      : null;
    const status = normalized?.canonicalStatus ?? null;
    return {
      trackingId: this.text(data.order_code) ?? trackingId,
      providerOrderReference: this.text(data.client_order_code),
      providerStatusCode: null,
      providerStatusText: statusText,
      status,
      currentLocation: this.pointForStatus(status),
      routePoints: this.demoRoutePoints,
      estimatedDeliveryAt: this.date(data.leadtime),
      occurredAt: this.date(data.updated_date) ?? new Date(),
      reason: normalized?.reason ?? null,
    };
  }

  // GHN nhận danh sách mã vận đơn ở endpoint switch-status/cancel.
  async cancelShipment(trackingId: string): Promise<void> {
    this.ensureConfigured();
    await this.requestJson<UnknownRecord>(
      "/shiip/public-api/v2/switch-status/cancel",
      "POST",
      { order_codes: [trackingId] },
      true,
    );
  }

  // GHN cấp print token rồi mới tải trang nhãn; tùy môi trường, endpoint trả PDF hoặc HTML in được.
  async printLabel(trackingId: string): Promise<PrintedShippingLabel> {
    this.ensureConfigured();
    const payload = await this.requestJson<UnknownRecord>(
      "/shiip/public-api/v2/a5/gen-token",
      "POST",
      { order_codes: [trackingId] },
    );
    const printToken = this.text(this.asRecord(payload.data).token);
    if (!printToken)
      throw new BadGatewayException("GHN không cấp được token in nhãn.");
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/a5/public-api/printA5?token=${encodeURIComponent(printToken)}`,
        {
          method: "GET",
          headers: { accept: "application/pdf, text/html" },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException("GHN Test hiện không sẵn sàng.");
    }
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = (
      (response.headers.get("content-type") ?? "").split(";", 1)[0] ?? ""
    )
      .trim()
      .toLowerCase();
    const isPdf = contentType === "application/pdf";
    const isHtml = contentType === "text/html";
    if (!response.ok || (!isPdf && !isHtml) || body.length === 0) {
      throw new BadGatewayException("GHN không thể in nhãn vận đơn.");
    }
    return {
      content: body,
      contentType: isPdf ? "application/pdf" : "text/html",
      fileExtension: isPdf ? "pdf" : "html",
    };
  }

  // Chuẩn hóa request, kiểm tra code nghiệp vụ vì GHN có thể trả HTTP 200 cho lỗi.
  private async requestJson<T extends UnknownRecord>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    requiresShop = false,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(requiresShop),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException("GHN Test hiện không sẵn sàng.");
    }
    const payload = (await response.json().catch(() => ({}))) as T;
    const code = this.numeric(payload.code);
    if (!response.ok || (code !== null && code !== 200))
      throw new BadGatewayException(
        this.text(payload.message) ?? "GHN từ chối request.",
      );
    return payload;
  }

  // GHN yêu cầu Token cho mọi API và ShopId cho fee/create/cancel.
  private headers(requiresShop = false): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      Token: this.token,
      ...(requiresShop && this.shopId ? { ShopId: String(this.shopId) } : {}),
    };
  }

  // Chặn gọi carrier khi thiếu token hoặc ShopId để lỗi hiển thị đúng nguyên nhân.
  private ensureConfigured(): void {
    if (!this.token)
      throw new ServiceUnavailableException(
        "GHN Test chưa được cấu hình GHN_TOKEN.",
      );
    if (!this.shopIdInput)
      throw new ServiceUnavailableException(
        "GHN Test chưa được cấu hình GHN_SHOP_ID.",
      );
    if (!this.shopId)
      throw new ServiceUnavailableException(
        "GHN_SHOP_ID phải là mã số nguyên dương, không chứa khoảng trắng hoặc dấu phân cách.",
      );
  }

  // Kiểm tra mã GHN đã lưu trước khi gọi fee hoặc tạo vận đơn.
  private async resolveAddress(address: ShippingAddress): Promise<GhnAddress> {
    const key =
      `${address.province}|${address.district}|${address.ward}|${JSON.stringify(address.ghnAddress ?? null)}`.toLowerCase();
    const cached = this.addressCache.get(key);
    if (cached) return cached;
    if (address.ghnAddress) {
      const resolved = await this.validateSelection(
        address.ghnAddress,
        address.province,
      );
      this.addressCache.set(key, resolved);
      return resolved;
    }
    throw new BadRequestException(
      "Địa chỉ chưa có đủ mã tỉnh, quận/huyện và phường/xã GHN.",
    );
  }

  // Kiểm tra lại mapping do client gửi để không cho phép tự ý gửi mã địa chỉ ngoài danh sách GHN.
  private async validateSelection(
    selection: GhnAddressSelection,
    provinceName: string,
  ): Promise<GhnAddress> {
    const provinces = await this.masterDataClient.listProvinces();
    const province = provinces.find((item) => item.id === selection.provinceId);
    const namedProvince = provinces.find(
      (item) =>
        this.normalizeName(item.name) === this.normalizeName(provinceName),
    );
    if (
      !province ||
      !namedProvince ||
      namedProvince.id !== selection.provinceId
    ) {
      throw new BadRequestException(
        "Khu vực GHN đã chọn không khớp với tỉnh/thành phố.",
      );
    }
    const districts = await this.masterDataClient.listDistricts(
      selection.provinceId,
    );
    const district = districts.find((item) => item.id === selection.districtId);
    if (!district)
      throw new BadRequestException(
        "Quận/huyện GHN đã chọn không thuộc tỉnh/thành phố.",
      );
    const wards = await this.masterDataClient.listWards(selection.districtId);
    const ward = wards.find((item) => item.code === selection.wardCode);
    if (!ward)
      throw new BadRequestException(
        "Phường/xã GHN đã chọn không thuộc quận/huyện.",
      );
    return {
      provinceId: selection.provinceId,
      districtId: selection.districtId,
      wardCode: selection.wardCode,
      provinceName: province.name,
      districtName: district.name,
      wardName: ward.name,
    };
  }

  // Gắn trạng thái GHN vào từng chặng minh họa để map và timeline cùng tiến về một điểm.
  private pointForStatus(status: ShipmentStatus | null): RoutePoint {
    const index = {
      [ShipmentStatus.READY_TO_SHIP]: 0,
      [ShipmentStatus.PICKUP_ASSIGNED]: 1,
      [ShipmentStatus.PICKED_UP]: 2,
      [ShipmentStatus.IN_TRANSIT]: 3,
      [ShipmentStatus.DELIVERED]: 4,
      [ShipmentStatus.FAILED]: 3,
      [ShipmentStatus.CANCELLED]: 0,
      [ShipmentStatus.RETURNING]: 2,
      [ShipmentStatus.RETURNED]: 1,
    }[status ?? ShipmentStatus.READY_TO_SHIP];
    return this.demoRoutePoints[index] ?? this.defaultPoint;
  }

  private normalizeName(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/thanh pho|tinh|quan|huyen|thi xa|phuong|xa|thi tran/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  // Gom kích thước shop đã nhập để GHN nhận cả kiện tổng và item chi tiết.
  private packageData(input: CreateShipmentInput): {
    weight: number;
    length: number;
    width: number;
    height: number;
  } {
    const weight = input.items.reduce(
      (sum, item) => sum + item.packageWeightGrams * item.quantity,
      0,
    );
    const length = Math.max(...input.items.map((item) => item.packageLengthCm));
    const width = Math.max(...input.items.map((item) => item.packageWidthCm));
    const height = input.items.reduce(
      (sum, item) => sum + item.packageHeightCm * item.quantity,
      0,
    );
    if (
      ![weight, length, width, height].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    )
      throw new BadRequestException(
        "Đơn hàng chưa đủ thông tin đóng gói cho GHN.",
      );
    return {
      weight: Math.round(weight),
      length: Math.round(length),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  private createPartnerReference(orderNumber: string, shopId: string, shipmentKind: "FORWARD" | "RETURN" = "FORWARD"): string {
    const prefix = shipmentKind === "RETURN" ? "BIN-RET" : "BIN";
    return `${prefix}-${orderNumber.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 180)}-${shopId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50)}`.slice(
      0,
      50,
    );
  }
  private money(value: unknown): string {
    return this.numeric(value)?.toFixed(2) ?? "0.00";
  }
  private asRecord(value: unknown): UnknownRecord {
    return typeof value === "object" && value !== null
      ? (value as UnknownRecord)
      : {};
  }
  private text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  private numeric(value: unknown): number | null {
    const result = typeof value === "number" ? value : Number(value);
    return Number.isFinite(result) ? result : null;
  }
  private date(value: unknown): Date | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? null : result;
  }
}
