// File này kiểm tra các invariant quan trọng của workflow hủy vận đơn trong Shipping Service.

/// <reference types="jest" />

import { type DeepMocked } from "@golevelup/ts-jest";
import { ConfigService } from "@nestjs/config";
import { DataSource, Repository } from "typeorm";
import { Shipment } from "../../../database/entities/shipment.entity";
import { ShipmentEvent } from "../../../database/entities/shipment-event.entity";
import { ShipmentStatus } from "../../../database/enums/shipment-status.enum";
import { ShipmentEventsPublisher } from "../../../kafka/shipment-events.publisher";
import { GhnMasterDataClient } from "../clients/ghn-master-data.client";
import { OrderClient } from "../clients/order.client";
import { SellerShopClient } from "../clients/seller-shop.client";
import { ShipmentRepository } from "../repositories/shipment.repository";
import { ShippingService } from "./shipping.service";
import type { ShippingProvider } from "../types/shipping.types";

describe("ShippingService cancellation consistency", () => {
  let target: ShippingService;
  let mockConfig: DeepMocked<ConfigService>;
  let mockDataSource: DeepMocked<DataSource>;
  let mockRepository: DeepMocked<ShipmentRepository>;
  let mockProvider: DeepMocked<ShippingProvider>;
  let mockOrderClient: DeepMocked<OrderClient>;
  let mockSellerShopClient: DeepMocked<SellerShopClient>;
  let mockGhnMasterDataClient: DeepMocked<GhnMasterDataClient>;
  let mockEvents: DeepMocked<ShipmentEventsPublisher>;
  let mockShipmentEntityRepository: DeepMocked<Repository<Shipment>>;

  const shipment = {
    id: "shipment-1",
    orderId: "order-1",
    orderNumber: "BIN-0001",
    shopId: "shop-1",
    shipmentKind: "FORWARD" as const,
    returnRequestId: null,
    sellerUserId: "seller-1",
    customerUserId: "customer-1",
    provider: "GHN_TEST",
    providerOrderReference: "BIN-BIN-0001-shop-1",
    providerTrackingId: "tracking-1",
    lastProviderSyncedAt: new Date("2026-09-03T10:00:00.000Z"),
    pickupAddressSnapshot: { contactName: "Shop" },
    trackingCode: "tracking-1",
    providerStatusCode: 0,
    providerStatusText: "ready_to_pick",
    status: ShipmentStatus.READY_TO_SHIP,
    currentLatitude: "10.7769",
    currentLongitude: "106.7009",
    currentLocationLabel: "Shop",
    routePoints: [{ latitude: 10.7769, longitude: 106.7009, label: "Shop" }],
    events: [],
    version: 1,
    createdAt: new Date("2026-09-03T10:00:00.000Z"),
    updatedAt: new Date("2026-09-03T10:00:00.000Z"),
    estimatedDeliveryAt: null,
  } as Shipment;

  beforeEach(() => {
    mockConfig = {} as DeepMocked<ConfigService>;
    mockDataSource = { transaction: jest.fn() } as unknown as DeepMocked<DataSource>;
    mockRepository = { getEntityRepository: jest.fn() } as unknown as DeepMocked<ShipmentRepository>;
    mockProvider = { cancelShipment: jest.fn() } as unknown as DeepMocked<ShippingProvider>;
    mockOrderClient = {} as DeepMocked<OrderClient>;
    mockSellerShopClient = {} as DeepMocked<SellerShopClient>;
    mockGhnMasterDataClient = {} as DeepMocked<GhnMasterDataClient>;
    mockEvents = { publish: jest.fn() } as unknown as DeepMocked<ShipmentEventsPublisher>;
    mockShipmentEntityRepository = { findOne: jest.fn() } as unknown as DeepMocked<Repository<Shipment>>;
    mockRepository.getEntityRepository.mockReturnValue(mockShipmentEntityRepository);
    mockShipmentEntityRepository.findOne.mockResolvedValue(shipment);
    mockProvider.cancelShipment.mockResolvedValue();
    mockEvents.publish.mockResolvedValue();
    target = new ShippingService(
      mockConfig,
      mockDataSource,
      mockRepository,
      mockProvider,
      mockOrderClient,
      mockSellerShopClient,
      mockGhnMasterDataClient,
      mockEvents,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Transaction promise resolve biểu thị local commit; callback Order phải chạy sau mốc này.
  it("should synchronize Order only after Shipping transaction commits", async () => {
    // Arrange
    const callOrder: string[] = [];
    const savedShipment = { ...shipment, status: ShipmentStatus.CANCELLED } as Shipment;
    const cancellationEvent = {
      id: "event-1",
      fromStatus: ShipmentStatus.READY_TO_SHIP,
      toStatus: ShipmentStatus.CANCELLED,
      reason: "Seller hết hàng",
      locationLabel: "Shop",
      occurredAt: new Date("2026-09-03T10:01:00.000Z"),
    } as ShipmentEvent;
    mockProvider.cancelShipment.mockImplementation(async () => {
      callOrder.push("ghn");
    });
    mockDataSource.transaction.mockImplementation(async () => {
      callOrder.push("shipping-commit");
      return { shipment: savedShipment, event: cancellationEvent };
    });
    mockEvents.publish.mockImplementation(async () => {
      callOrder.push("event-publish");
    });
    const syncOrder = jest.fn(async () => {
      callOrder.push("order-sync");
    });

    // Act
    const result = await target.cancelInternal("shipment-1", "Seller hết hàng", syncOrder);

    // Assert
    expect(result.status).toBe(ShipmentStatus.CANCELLED);
    expect(callOrder).toEqual(["ghn", "shipping-commit", "order-sync", "event-publish"]);
    expect(syncOrder).toHaveBeenCalledTimes(1);
  });

  // Shipment đã hủy không gọi lại GHN; retry chỉ thực hiện callback để khôi phục đồng bộ Order còn thiếu.
  it("should retry Order synchronization without calling GHN after local cancellation", async () => {
    // Arrange
    const cancelledShipment = { ...shipment, status: ShipmentStatus.CANCELLED } as Shipment;
    mockShipmentEntityRepository.findOne.mockResolvedValue(cancelledShipment);
    const syncOrder = jest.fn().mockResolvedValue(undefined);

    // Act
    const result = await target.cancelInternal("shipment-1", "Seller hết hàng", syncOrder);

    // Assert
    expect(result.status).toBe(ShipmentStatus.CANCELLED);
    expect(syncOrder).toHaveBeenCalledTimes(1);
    expect(mockProvider.cancelShipment).not.toHaveBeenCalled();
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });
});
