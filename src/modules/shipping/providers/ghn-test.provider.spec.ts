// Kiểm thử contract GHN Test mà không gửi request ra hệ thống bên ngoài.

/// <reference types="jest" />

import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ShipmentStatus } from "../../../database/enums/shipment-status.enum";
import type {
  ShippingAddress,
  ShippingQuoteInput,
} from "../types/shipping.types";
import { GhnTestProvider } from "./ghn-test.provider";
import { GhnMasterDataClient } from "../clients/ghn-master-data.client";

const ghnAddress = {
  provinceId: 202,
  districtId: 1442,
  wardCode: "20106",
  districtName: "Quận 1",
  wardName: "Phường Bến Nghé",
};
const pickup: ShippingAddress = {
  contactName: "Shop BIN",
  phone: "0900000000",
  addressLine: "14 Nguyễn Văn Lượng",
  province: "Hồ Chí Minh",
  district: "Quận 1",
  ward: "Bến Nghé",
  ghnAddress,
};
const destination: ShippingAddress = {
  contactName: "Người nhận",
  phone: "0911111111",
  addressLine: "1 Nguyễn Huệ",
  province: "Hồ Chí Minh",
  district: "Quận 1",
  ward: "Bến Nghé",
  ghnAddress,
};

function createProvider(): GhnTestProvider {
  return new GhnTestProvider(
    new ConfigService({
      GHN_BASE_URL: "https://dev-online-gateway.ghn.vn",
      GHN_TOKEN: "test-token",
      GHN_SHOP_ID: "885",
      GHN_REQUEST_TIMEOUT_MS: 1_000,
    }),
  );
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
}

function masterDataResponse(url: string): Response | null {
  if (url.endsWith("/province"))
    return jsonResponse({
      code: 200,
      data: [{ ProvinceID: 202, ProvinceName: "Hồ Chí Minh" }],
    });
  if (url.endsWith("/district"))
    return jsonResponse({
      code: 200,
      data: [{ DistrictID: 1442, DistrictName: "Quận 1" }],
    });
  if (url.endsWith("/ward"))
    return jsonResponse({
      code: 200,
      data: [{ WardCode: "20106", WardName: "Bến Nghé" }],
    });
  return null;
}

describe("GhnTestProvider", () => {
  afterEach(() => jest.restoreAllMocks());

  it("should calculate fee with GHN headers, dimensions and gram weight", async () => {
    // Arrange
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        return (
          masterDataResponse(url) ??
          jsonResponse({
            code: 200,
            data: {
              total: 36300,
              service_fee: 30000,
              insurance_fee: 5000,
              cod_fee: 1300,
            },
          })
        );
      });
    const input: ShippingQuoteInput = {
      shopId: "shop-1",
      from: pickup,
      to: destination,
      weightGrams: 1_250,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      value: 450_000,
      codAmount: 450_000,
    };

    // Act
    const quote = await createProvider().calculateFee(input);
    const feeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/shipping-order/fee"),
    );
    const options = feeCall?.[1] as RequestInit;

    // Assert
    expect(JSON.parse(String(options.body))).toMatchObject({
      weight: 1250,
      length: 20,
      width: 15,
      height: 10,
      to_district_id: 1442,
      to_ward_code: "20106",
    });
    expect(options.headers).toMatchObject({
      Token: "test-token",
      ShopId: "885",
    });
    expect(quote).toMatchObject({
      provider: "GHN_TEST",
      fee: "36300.00",
      deliverySupported: true,
    });
  });

  it("should create a GHN order with stable client code and COD goods amount", async () => {
    // Arrange
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        return (
          masterDataResponse(url) ??
          jsonResponse({
            code: 200,
            data: {
              order_code: "A1B2C3D4",
              status: "ready_to_pick",
              expected_delivery_time: "2026-09-02T10:00:00Z",
            },
          })
        );
      });

    // Act
    const shipment = await createProvider().createShipment({
      orderId: "order-1",
      orderNumber: "1001",
      shopId: "shop-1",
      pickupAddress: pickup,
      shippingAddress: destination,
      items: [
        {
          productId: "product-1",
          sku: "SKU-1",
          productName: "Áo thun",
          imageUrl: null,
          unitPrice: "450000",
          quantity: 2,
          lineTotal: "900000",
          packageWeightGrams: 750,
          packageLengthCm: 20,
          packageWidthCm: 15,
          packageHeightCm: 5,
        },
      ],
      value: 900_000,
      codAmount: 900_000,
    });
    const orderCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/shipping-order/create"),
    );
    const body = JSON.parse(String((orderCall?.[1] as RequestInit).body));

    // Assert
    expect(body).toMatchObject({
      client_order_code: "BIN-1001-shop-1",
      cod_amount: 900000,
      payment_type_id: 2,
      weight: 1500,
      length: 20,
      width: 15,
      height: 10,
    });
    expect(shipment).toMatchObject({
      trackingId: "A1B2C3D4",
      status: ShipmentStatus.READY_TO_SHIP,
    });
  });

  // Xác nhận các thao tác tracking, hủy và tải nhãn đều dùng đúng endpoint GHN.
  it("should fetch, cancel and print through GHN endpoints", async () => {
    // Arrange
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/shipping-order/detail"))
          return jsonResponse({
            code: 200,
            data: {
              order_code: "A1B2C3D4",
              client_order_code: "BIN-1001-shop-1",
              status: "delivering",
              updated_date: "2026-09-01T10:00:00Z",
            },
          });
        if (url.endsWith("/switch-status/cancel"))
          return jsonResponse({ code: 200, data: [{ result: true }] });
        if (url.endsWith("/a5/gen-token"))
          return jsonResponse({ code: 200, data: { token: "print-token" } });
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/pdf" }),
          json: async () => ({}),
          arrayBuffer: async () => new TextEncoder().encode("pdf").buffer,
        } as Response;
      });

    // Act
    const target = createProvider();
    const tracking = await target.getShipment("A1B2C3D4");
    await target.cancelShipment("A1B2C3D4");
    const label = await target.printLabel("A1B2C3D4");

    // Assert
    expect(tracking.status).toBe(ShipmentStatus.IN_TRANSIT);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/switch-status/cancel"),
      ),
    ).toBe(true);
    expect(label.content.toString()).toBe("pdf");
    expect(label.contentType).toBe("application/pdf");
    expect(label.fileExtension).toBe("pdf");
  });

  // GHN Test thực tế có thể trả trang HTML in A5 thay vì binary PDF.
  it("should accept the printable HTML returned by GHN", async () => {
    // Arrange
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/a5/gen-token"))
        return jsonResponse({ code: 200, data: { token: "print-token" } });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        json: async () => ({}),
        arrayBuffer: async () =>
          new TextEncoder().encode("<html><title>Phiếu In A5</title></html>")
            .buffer,
      } as Response;
    });

    // Act
    const label = await createProvider().printLabel("A1B2C3D4");

    // Assert
    expect(label.content.toString()).toContain("Phiếu In A5");
    expect(label.contentType).toBe("text/html");
    expect(label.fileExtension).toBe("html");
  });

  it("should reject missing GHN shop id before making a request", async () => {
    // Arrange
    const target = new GhnTestProvider(
      new ConfigService({ GHN_TOKEN: "test-token" }),
    );

    // Act & Assert
    await expect(
      target.calculateFee({
        shopId: "shop-1",
        from: pickup,
        to: destination,
        weightGrams: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
        value: 0,
        codAmount: 0,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("should reject a formatted GHN shop id", async () => {
    // Arrange
    const target = new GhnTestProvider(
      new ConfigService({
        GHN_TOKEN: "test-token",
        GHN_SHOP_ID: "123456 - 9876543210",
      }),
    );

    // Act & Assert
    await expect(
      target.calculateFee({
        shopId: "shop-1",
        from: pickup,
        to: destination,
        weightGrams: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
        value: 0,
        codAmount: 0,
      }),
    ).rejects.toThrow("GHN_SHOP_ID phải là mã số nguyên dương");
  });

  it("should reject an address without GHN codes", async () => {
    // Arrange
    const target = createProvider();
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (input) =>
          masterDataResponse(String(input)) ??
          jsonResponse({ code: 200, data: [] }),
      );
    // Act & Assert
    await expect(
      target.calculateFee({
        shopId: "shop-1",
        from: pickup,
        to: { ...destination, ghnAddress: undefined },
        weightGrams: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
        value: 0,
        codAmount: 0,
      }),
    ).rejects.toThrow("Địa chỉ chưa có đủ mã");
  });

  it("should list GHN master data through the dedicated methods", async () => {
    // Arrange
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (input) =>
          masterDataResponse(String(input)) ??
          jsonResponse({ code: 200, data: [] }),
      );

    // Act
    const target = new GhnMasterDataClient(
      new ConfigService({
        GHN_BASE_URL: "https://dev-online-gateway.ghn.vn",
        GHN_TOKEN: "test-token",
        GHN_REQUEST_TIMEOUT_MS: 1_000,
      }),
    );
    const provinces = await target.listProvinces();
    const districts = await target.listDistricts(202);
    const wards = await target.listWards(1442);

    // Assert
    expect(provinces).toEqual([{ id: 202, name: "Hồ Chí Minh" }]);
    expect(districts).toEqual([{ id: 1442, name: "Quận 1", provinceId: 202 }]);
    expect(wards).toEqual([
      { code: "20106", name: "Bến Nghé", districtId: 1442 },
    ]);
  });

  it("should reject GHN business errors returned with HTTP 200", async () => {
    // Arrange
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ code: 400, message: "Token is not valid!" }),
      );

    // Act & Assert
    await expect(
      createProvider().getShipment("A1B2C3D4"),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
