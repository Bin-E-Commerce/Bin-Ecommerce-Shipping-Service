// File này kiểm tra các invariant quan trọng của workflow hủy vận đơn trong Shipping Service.

/// <reference types="jest" />

import { type DeepMocked } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Shipment } from '@/database/entities/shipment.entity';
import { ShipmentEvent } from '@/database/entities/shipment-event.entity';
import { ShipmentStatus } from '@/database/enums/shipment-status.enum';
import { ShipmentEventsPublisher } from '@/kafka/shipment-events.publisher';
import { GhnMasterDataClient } from '@/modules/shipping/application/clients/ghn-master-data.client';
import { OrderClient } from '@/modules/shipping/application/clients/order.client';
import { SellerShopClient } from '@/modules/shipping/application/clients/seller-shop.client';
import { ShipmentRepository } from '@/modules/shipping/infrastructure/repositories/shipment.repository';
import { ShippingService } from '@/modules/shipping/application/services/shipping.service';
import type { ShippingProvider } from '@/modules/shipping/application/types/shipping.types';

describe('ShippingService consistency', () => {
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
        id: 'shipment-1',
        orderId: 'order-1',
        orderNumber: 'BIN-0001',
        shopId: 'shop-1',
        shipmentKind: 'FORWARD' as const,
        returnRequestId: null,
        sellerUserId: 'seller-1',
        customerUserId: 'customer-1',
        provider: 'GHN_TEST',
        providerOrderReference: 'BIN-BIN-0001-shop-1',
        providerTrackingId: 'tracking-1',
        lastProviderSyncedAt: new Date('2026-09-03T10:00:00.000Z'),
        pickupAddressSnapshot: { contactName: 'Shop' },
        trackingCode: 'tracking-1',
        providerStatusCode: 0,
        providerStatusText: 'ready_to_pick',
        status: ShipmentStatus.READY_TO_SHIP,
        currentLatitude: '10.7769',
        currentLongitude: '106.7009',
        currentLocationLabel: 'Shop',
        routePoints: [
            { latitude: 10.7769, longitude: 106.7009, label: 'Shop' },
        ],
        events: [],
        version: 1,
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
        updatedAt: new Date('2026-09-03T10:00:00.000Z'),
        estimatedDeliveryAt: null,
    } as Shipment;

    beforeEach(() => {
        mockConfig = { get: jest.fn() } as unknown as DeepMocked<ConfigService>;
        mockDataSource = {
            transaction: jest.fn(),
        } as unknown as DeepMocked<DataSource>;
        mockRepository = {
            findByReturnRequest: jest.fn(),
            getEntityRepository: jest.fn(),
        } as unknown as DeepMocked<ShipmentRepository>;
        mockProvider = {
            cancelShipment: jest.fn(),
            createShipment: jest.fn(),
            getShipment: jest.fn(),
        } as unknown as DeepMocked<ShippingProvider>;
        mockOrderClient = {
            getReturnShippingContext: jest.fn(),
            markReturnInTransit: jest.fn(),
            markReturnReceived: jest.fn(),
            updateReturnShippingCost: jest.fn(),
        } as unknown as DeepMocked<OrderClient>;
        mockSellerShopClient = {
            getOwnedShopId: jest.fn(),
            getDefaultPickupAddress: jest.fn(),
        } as unknown as DeepMocked<SellerShopClient>;
        mockGhnMasterDataClient = {} as DeepMocked<GhnMasterDataClient>;
        mockEvents = {
            publish: jest.fn(),
        } as unknown as DeepMocked<ShipmentEventsPublisher>;
        mockShipmentEntityRepository = {
            findOne: jest.fn(),
        } as unknown as DeepMocked<Repository<Shipment>>;
        mockRepository.getEntityRepository.mockReturnValue(
            mockShipmentEntityRepository,
        );
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
    it('should synchronize Order only after Shipping transaction commits', async () => {
        // Arrange
        const callOrder: string[] = [];
        const savedShipment = {
            ...shipment,
            status: ShipmentStatus.CANCELLED,
        } as Shipment;
        const cancellationEvent = {
            id: 'event-1',
            fromStatus: ShipmentStatus.READY_TO_SHIP,
            toStatus: ShipmentStatus.CANCELLED,
            reason: 'Seller hết hàng',
            locationLabel: 'Shop',
            occurredAt: new Date('2026-09-03T10:01:00.000Z'),
        } as ShipmentEvent;
        mockProvider.cancelShipment.mockImplementation(async () => {
            callOrder.push('ghn');
        });
        mockDataSource.transaction.mockImplementation(async () => {
            callOrder.push('shipping-commit');
            return { shipment: savedShipment, event: cancellationEvent };
        });
        mockEvents.publish.mockImplementation(async () => {
            callOrder.push('event-publish');
        });
        const syncOrder = jest.fn(async () => {
            callOrder.push('order-sync');
        });

        // Act
        const result = await target.cancelInternal(
            'shipment-1',
            'Seller hết hàng',
            syncOrder,
        );

        // Assert
        expect(result.status).toBe(ShipmentStatus.CANCELLED);
        expect(callOrder).toEqual([
            'ghn',
            'shipping-commit',
            'order-sync',
            'event-publish',
        ]);
        expect(syncOrder).toHaveBeenCalledTimes(1);
    });

    // Shipment đã hủy không gọi lại GHN; retry chỉ thực hiện callback để khôi phục đồng bộ Order còn thiếu.
    it('should retry Order synchronization without calling GHN after local cancellation', async () => {
        // Arrange
        const cancelledShipment = {
            ...shipment,
            status: ShipmentStatus.CANCELLED,
        } as Shipment;
        mockShipmentEntityRepository.findOne.mockResolvedValue(
            cancelledShipment,
        );
        const syncOrder = jest.fn().mockResolvedValue(undefined);

        // Act
        const result = await target.cancelInternal(
            'shipment-1',
            'Seller hết hàng',
            syncOrder,
        );

        // Assert
        expect(result.status).toBe(ShipmentStatus.CANCELLED);
        expect(syncOrder).toHaveBeenCalledTimes(1);
        expect(mockProvider.cancelShipment).not.toHaveBeenCalled();
        expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    // Khi local transaction rollback, GHN phải được gọi compensation để không tồn tại vận đơn không có shipment local.
    it('should cancel GHN when saving a return shipment fails', async () => {
        // Arrange
        mockConfig.get.mockReturnValue('development');
        mockSellerShopClient.getOwnedShopId.mockResolvedValue('shop-1');
        mockSellerShopClient.getDefaultPickupAddress.mockResolvedValue({
            id: 'pickup-1',
            contactName: 'Shop',
            phone: '0900000000',
            addressLine: '123 Shop Street',
            ghnProvinceId: 202,
            ghnProvinceName: 'Ho Chi Minh',
            ghnDistrictId: 1442,
            ghnDistrictName: 'District 1',
            ghnWardCode: '20101',
            ghnWardName: 'Ben Nghe',
        } as never);
        mockRepository.findByReturnRequest.mockResolvedValue(null);
        mockOrderClient.getReturnShippingContext.mockResolvedValue({
            returnId: 'return-1',
            orderId: 'order-1',
            orderNumber: 'BIN-0001',
            ownerId: 'customer-1',
            shopId: 'shop-1',
            shippingAddress: {
                contactName: 'Customer',
                phone: '0910000000',
                addressLine: '456 Customer Street',
                province: 'Ho Chi Minh',
                district: 'District 1',
                ward: 'Ben Nghe',
                ghnAddress: {
                    provinceId: 202,
                    districtId: 1442,
                    wardCode: '20101',
                    districtName: 'District 1',
                    wardName: 'Ben Nghe',
                },
            },
            items: [
                {
                    productId: 'product-1',
                    sku: 'SKU-1',
                    productName: 'Product 1',
                    imageUrl: null,
                    unitPrice: '100000.00',
                    quantity: 1,
                    lineTotal: '100000.00',
                    packageWeightGrams: 500,
                    packageLengthCm: 20,
                    packageWidthCm: 15,
                    packageHeightCm: 10,
                },
            ],
        });
        mockProvider.createShipment.mockResolvedValue({
            providerOrderReference: 'BIN-RET-BIN-0001-shop-1',
            trackingId: 'return-tracking-1',
            providerStatusCode: null,
            providerStatusText: 'ready_to_pick',
            status: ShipmentStatus.READY_TO_SHIP,
            currentLocation: {
                latitude: 10.7769,
                longitude: 106.7009,
                label: 'GHN',
            },
            routePoints: [
                { latitude: 10.7769, longitude: 106.7009, label: 'GHN' },
            ],
            estimatedDeliveryAt: null,
            shippingFee: '12000.00',
        });
        mockOrderClient.updateReturnShippingCost.mockResolvedValue();
        const databaseError = new Error('shipment insert failed');
        mockDataSource.transaction.mockRejectedValue(databaseError);
        const currentUser = {
            userId: 'seller-1',
            email: 'seller@example.com',
            permissions: ['seller.shipping.manage'],
        };

        // Act
        const operation = target.createReturnForSeller('return-1', currentUser);

        // Assert
        await expect(operation).rejects.toBe(databaseError);
        expect(mockProvider.cancelShipment).toHaveBeenCalledWith(
            'return-tracking-1',
        );
        expect(mockProvider.cancelShipment).toHaveBeenCalledTimes(1);
        expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });

    // Reverse shipment phải đi qua state machine riêng để RETURNING và RETURNED
    // được lưu đúng, đồng thời đồng bộ đúng mốc xử lý sang Order Service.
    it('should advance reverse shipment through RETURNING and RETURNED', async () => {
        // Arrange
        const reverseShipment = {
            ...shipment,
            shipmentKind: 'RETURN' as const,
            returnRequestId: 'return-1',
            status: ShipmentStatus.IN_TRANSIT,
            events: [],
        } as Shipment;
        const shipmentRepository = {
            createQueryBuilder: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnThis(),
                setLock: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(reverseShipment),
            }),
            save: jest.fn(async (entity: Shipment) => entity),
        };
        const eventRepository = {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((event: Partial<ShipmentEvent>) => ({
                id: `event-${event.toStatus}`,
                ...event,
            })),
            save: jest.fn(async (event: ShipmentEvent) => event),
        };
        const manager = {
            getRepository: jest.fn(
                (entity: typeof Shipment | typeof ShipmentEvent) =>
                    entity === Shipment ? shipmentRepository : eventRepository,
            ),
        };
        mockDataSource.transaction.mockImplementation(async (callback) =>
            (callback as unknown as (value: unknown) => Promise<unknown>)(
                manager,
            ),
        );
        mockShipmentEntityRepository.findOne.mockResolvedValue(reverseShipment);
        mockProvider.getShipment
            .mockResolvedValueOnce({
                trackingId: 'return-tracking-1',
                providerOrderReference: 'return-order-1',
                providerStatusCode: 45,
                providerStatusText: 'returning',
                status: ShipmentStatus.RETURNING,
                currentLocation: null,
                estimatedDeliveryAt: null,
                occurredAt: new Date('2026-09-03T10:01:00.000Z'),
                reason: 'Đang hoàn về shop',
            })
            .mockResolvedValueOnce({
                trackingId: 'return-tracking-1',
                providerOrderReference: 'return-order-1',
                providerStatusCode: 46,
                providerStatusText: 'returned',
                status: ShipmentStatus.RETURNED,
                currentLocation: null,
                estimatedDeliveryAt: null,
                occurredAt: new Date('2026-09-03T10:02:00.000Z'),
                reason: 'Đã hoàn về shop',
            });

        // Act
        const returning = await target.syncInternal('shipment-1');
        const returned = await target.syncInternal('shipment-1');

        // Assert
        expect(returning.status).toBe(ShipmentStatus.RETURNING);
        expect(returned.status).toBe(ShipmentStatus.RETURNED);
        expect(mockOrderClient.markReturnInTransit).toHaveBeenCalledWith(
            'return-1',
        );
        expect(mockOrderClient.markReturnReceived).toHaveBeenCalledWith(
            'return-1',
        );
        expect(mockOrderClient.markReturnInTransit).toHaveBeenCalledTimes(1);
        expect(mockOrderClient.markReturnReceived).toHaveBeenCalledTimes(1);
    });
});
