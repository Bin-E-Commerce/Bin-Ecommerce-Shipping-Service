// Điều phối quote, tạo shipment, đồng bộ GHN và bảo vệ state machine theo shop scope.

import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Shipment } from '@/database/entities/shipment.entity';
import { ShipmentEvent } from '@/database/entities/shipment-event.entity';
import { ShipmentStatus } from '@/database/enums/shipment-status.enum';
import { ShipmentRepository } from '@/modules/shipping/infrastructure/repositories/shipment.repository';
import { OrderClient } from '@/modules/shipping/application/clients/order.client';
import { SellerShopClient } from '@/modules/shipping/application/clients/seller-shop.client';
import { GhnMasterDataClient } from '@/modules/shipping/application/clients/ghn-master-data.client';
import type { SellerPickupAddressResponse } from '@/modules/shipping/application/clients/seller-shop.client';
import type {
    CurrentSellerContext,
    GhnDistrictOption,
    GhnProvinceOption,
    GhnWardOption,
    ProviderShipmentStatus,
    ShippingProvider,
    ShippingQuote,
    ShippingOrderContext,
} from '@/modules/shipping/application/types/shipping.types';
import {
    GHN_PROVIDER,
    SHIPPING_PROVIDER,
} from '@/modules/shipping/application/types/shipping.types';
import type {
    CustomerTrackingResponse,
    ShipmentResponse,
} from '@/modules/shipping/application/types/shipping-response.types';
import { ShipmentEventsPublisher } from '@/kafka/shipment-events.publisher';
import type { CalculateShippingQuoteDto } from '@/modules/shipping/presentation/dto/calculate-shipping-quote.dto';

const ACTIVE_STATUSES = new Set<ShipmentStatus>([
    ShipmentStatus.READY_TO_SHIP,
    ShipmentStatus.PICKUP_ASSIGNED,
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.RETURNING,
]);

const STATUS_LABELS: Record<ShipmentStatus, string> = {
    [ShipmentStatus.READY_TO_SHIP]: 'Shop đang chuẩn bị hàng',
    [ShipmentStatus.PICKUP_ASSIGNED]: 'Đã phân công lấy hàng',
    [ShipmentStatus.PICKED_UP]: 'Đơn vị vận chuyển đã lấy hàng',
    [ShipmentStatus.IN_TRANSIT]: 'Đang trên đường giao',
    [ShipmentStatus.DELIVERED]: 'Giao hàng thành công',
    [ShipmentStatus.FAILED]: 'Giao hàng thất bại',
    [ShipmentStatus.CANCELLED]: 'Vận đơn đã hủy',
    [ShipmentStatus.RETURNING]: 'Đang hoàn hàng',
    [ShipmentStatus.RETURNED]: 'Đã hoàn hàng',
};

const FORWARD_STATUS_RANK: Partial<Record<ShipmentStatus, number>> = {
    [ShipmentStatus.READY_TO_SHIP]: 10,
    [ShipmentStatus.PICKUP_ASSIGNED]: 20,
    [ShipmentStatus.PICKED_UP]: 30,
    [ShipmentStatus.IN_TRANSIT]: 40,
    [ShipmentStatus.DELIVERED]: 50,
};

// Reverse shipment có vòng đời riêng: sau khi rời shop, kiện hàng chuyển sang
// RETURNING trước khi kết thúc ở RETURNED. Tách rank này khỏi chiều giao để
// webhook GHN không bị từ chối chỉ vì RETURNING/RETURNED không thuộc forward flow.
const RETURN_STATUS_RANK: Partial<Record<ShipmentStatus, number>> = {
    [ShipmentStatus.READY_TO_SHIP]: 10,
    [ShipmentStatus.PICKUP_ASSIGNED]: 20,
    [ShipmentStatus.PICKED_UP]: 30,
    [ShipmentStatus.IN_TRANSIT]: 40,
    [ShipmentStatus.RETURNING]: 50,
    [ShipmentStatus.RETURNED]: 60,
};

const DEMO_STATUS_SEQUENCE: ShipmentStatus[] = [
    ShipmentStatus.READY_TO_SHIP,
    ShipmentStatus.PICKUP_ASSIGNED,
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.DELIVERED,
];

const DEMO_RETURN_STATUS_SEQUENCE: ShipmentStatus[] = [
    ShipmentStatus.READY_TO_SHIP,
    ShipmentStatus.PICKUP_ASSIGNED,
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.RETURNING,
    ShipmentStatus.RETURNED,
];

const DEMO_STATUS_REASONS: Record<ShipmentStatus, string> = {
    [ShipmentStatus.READY_TO_SHIP]:
        'Shop đã xác nhận kiện hàng sẵn sàng bàn giao.',
    [ShipmentStatus.PICKUP_ASSIGNED]: 'GHN đã phân công shipper đến lấy hàng.',
    [ShipmentStatus.PICKED_UP]: 'Shipper đã nhận kiện hàng từ shop.',
    [ShipmentStatus.IN_TRANSIT]: 'Kiện hàng đang di chuyển đến khu vực giao.',
    [ShipmentStatus.DELIVERED]:
        'Đơn hàng đã được giao thành công cho người nhận.',
    [ShipmentStatus.FAILED]: 'Đơn hàng giao thất bại trong bản demo.',
    [ShipmentStatus.CANCELLED]: 'Vận đơn đã hủy trong bản demo.',
    [ShipmentStatus.RETURNING]:
        'Kiện hàng đang được hoàn về shop trong bản demo.',
    [ShipmentStatus.RETURNED]: 'Kiện hàng đã hoàn về shop trong bản demo.',
};

type EventSource = 'WEBHOOK' | 'POLL' | 'SYSTEM';

@Injectable()
export class ShippingService {
    private readonly logger = new Logger(ShippingService.name);

    // Inject provider qua port để business flow không phụ thuộc HTTP adapter cụ thể.
    constructor(
        private readonly config: ConfigService,
        private readonly dataSource: DataSource,
        private readonly repository: ShipmentRepository,
        @Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
        private readonly orderClient: OrderClient,
        private readonly sellerShopClient: SellerShopClient,
        private readonly ghnMasterDataClient: GhnMasterDataClient,
        private readonly events: ShipmentEventsPublisher,
    ) {}

    // Quote luôn enrich địa chỉ shop từ Seller Service, browser không được gửi địa chỉ nguồn.
    // Quote RETURN dùng địa chỉ customer trong input làm điểm gửi và địa chỉ shop làm điểm nhận,
    // để GHN tính đúng chi phí chiều ngược thay vì lấy phí giao hàng chiều đi.
    async calculateQuote(
        input: CalculateShippingQuoteDto,
    ): Promise<ShippingQuote> {
        const pickup = await this.sellerShopClient.getDefaultPickupAddress(
            input.shopId,
        );
        const pickupAddress = this.toShippingAddress(pickup);
        const customerAddress = this.ensureDestination(input.to);
        const isReturn = input.shipmentKind === 'RETURN';
        return this.provider.calculateFee({
            shopId: input.shopId,
            from: isReturn ? customerAddress : pickupAddress,
            to: isReturn ? pickupAddress : customerAddress,
            weightGrams: input.weightGrams,
            lengthCm: input.lengthCm,
            widthCm: input.widthCm,
            heightCm: input.heightCm,
            value: input.value,
            codAmount: input.codAmount,
        });
    }

    // Cung cấp tỉnh/thành phố GHN qua application service để controller không phụ thuộc adapter.
    async listGhnProvinces(): Promise<GhnProvinceOption[]> {
        return this.ghnMasterDataClient.listProvinces();
    }

    // Cung cấp quận/huyện GHN theo tỉnh đã chọn.
    async listGhnDistricts(provinceId: number): Promise<GhnDistrictOption[]> {
        return this.ghnMasterDataClient.listDistricts(provinceId);
    }

    // Cung cấp phường/xã GHN theo quận/huyện đã chọn.
    async listGhnWards(districtId: number): Promise<GhnWardOption[]> {
        return this.ghnMasterDataClient.listWards(districtId);
    }

    // Tạo shipment idempotent theo order/shop và resolve timeout bằng partner reference ổn định.
    async createForSeller(
        orderId: string,
        currentUser: CurrentSellerContext,
    ): Promise<ShipmentResponse> {
        this.ensureSellerContext(currentUser, true);
        const shopId = await this.sellerShopClient.getOwnedShopId(currentUser);
        const existing = await this.repository.findByOrderAndShop(
            orderId,
            shopId,
        );
        if (existing) {
            return this.toResponse(existing);
        }

        const order = await this.orderClient.getSellerShippingContext(
            orderId,
            currentUser.userId,
            shopId,
        );
        if (order.orderStatus !== 'CONFIRMED') {
            throw new ConflictException(
                'Chỉ có thể tạo vận đơn cho đơn hàng đã xác nhận.',
            );
        }
        this.validatePackageContext(order);
        const pickup =
            await this.sellerShopClient.getDefaultPickupAddress(shopId);
        const pickupAddress = this.toShippingAddress(pickup);
        const destination = this.ensureDestination(order.shippingAddress);
        const value = order.items.reduce(
            (total, item) => total + Number(item.lineTotal),
            0,
        );
        const providerOrderReference = this.providerOrderReference(
            order.orderNumber,
            shopId,
        );

        let providerShipment: Awaited<
            ReturnType<ShippingProvider['createShipment']>
        >;
        try {
            providerShipment = await this.provider.createShipment({
                orderId,
                orderNumber: order.orderNumber,
                shopId,
                pickupAddress,
                shippingAddress: destination,
                items: order.items,
                value,
                codAmount: value,
            });
        } catch (error) {
            // Timeout không retry mù; tracking theo client order code trước để không đăng trùng đơn GHN.
            const recovered = await this.provider
                .getShipment(providerOrderReference)
                .catch(() => null);
            if (!recovered?.trackingId) throw error;
            providerShipment = {
                providerOrderReference,
                trackingId: recovered.trackingId,
                providerStatusCode: recovered.providerStatusCode,
                providerStatusText: recovered.providerStatusText,
                status: recovered.status ?? ShipmentStatus.READY_TO_SHIP,
                currentLocation: recovered.currentLocation ?? {
                    latitude: 0,
                    longitude: 0,
                    label: 'GHN Test',
                },
                routePoints: recovered.currentLocation
                    ? [recovered.currentLocation]
                    : [],
                estimatedDeliveryAt: recovered.estimatedDeliveryAt,
            };
        }

        const transition = await this.dataSource.transaction(
            async (manager) => {
                const shipmentRepository = manager.getRepository(Shipment);
                const eventRepository = manager.getRepository(ShipmentEvent);
                const shipment = shipmentRepository.create({
                    orderId,
                    orderNumber: order.orderNumber,
                    shopId,
                    shipmentKind: 'FORWARD',
                    returnRequestId: null,
                    sellerUserId: currentUser.userId,
                    customerUserId: order.ownerId,
                    provider: GHN_PROVIDER,
                    providerOrderReference:
                        providerShipment.providerOrderReference,
                    providerTrackingId: providerShipment.trackingId,
                    providerStatusCode: providerShipment.providerStatusCode,
                    providerStatusText: providerShipment.providerStatusText,
                    lastProviderSyncedAt: new Date(),
                    pickupAddressSnapshot: { ...pickupAddress },
                    trackingCode: providerShipment.trackingId,
                    status: providerShipment.status,
                    currentLatitude: String(
                        providerShipment.currentLocation.latitude,
                    ),
                    currentLongitude: String(
                        providerShipment.currentLocation.longitude,
                    ),
                    currentLocationLabel:
                        providerShipment.currentLocation.label,
                    routePoints: providerShipment.routePoints,
                    estimatedDeliveryAt: providerShipment.estimatedDeliveryAt,
                });
                const saved = await shipmentRepository.save(shipment);
                const event = eventRepository.create({
                    shipmentId: saved.id,
                    providerEventKey: `create:${saved.providerTrackingId}`,
                    fromStatus: null,
                    toStatus: saved.status,
                    reason: 'Tạo vận đơn GHN Test thành công.',
                    latitude: saved.currentLatitude,
                    longitude: saved.currentLongitude,
                    locationLabel: saved.currentLocationLabel,
                    providerStatusCode: saved.providerStatusCode,
                    eventSource: 'SYSTEM',
                    occurredAt: new Date(),
                });
                await eventRepository.save(event);
                saved.events = [event];
                return { shipment: saved, event };
            },
        );

        await this.events.publish(transition.shipment, transition.event);
        return this.toResponse(transition.shipment);
    }

    // Tạo reverse shipment từ customer về đúng shop; idempotency dựa trên returnRequestId.
    async createReturnForSeller(
        returnRequestId: string,
        currentUser: CurrentSellerContext,
    ): Promise<ShipmentResponse> {
        this.ensureSellerContext(currentUser, true);
        const shopId = await this.sellerShopClient.getOwnedShopId(currentUser);
        const existing =
            await this.repository.findByReturnRequest(returnRequestId);
        if (existing) {
            if (
                ![
                    ShipmentStatus.RETURNED,
                    ShipmentStatus.CANCELLED,
                    ShipmentStatus.FAILED,
                ].includes(existing.status)
            ) {
                await this.orderClient.markReturnInTransit(returnRequestId);
            }
            return this.toResponse(existing);
        }
        const context =
            await this.orderClient.getReturnShippingContext(returnRequestId);
        if (context.shopId !== shopId)
            throw new NotFoundException(
                'Yêu cầu hoàn không thuộc shop hiện tại.',
            );
        const pickupAddress = this.toCustomerAddress(
            context.shippingAddress as unknown as Record<string, unknown>,
        );
        const shopAddress = this.toShippingAddress(
            await this.sellerShopClient.getDefaultPickupAddress(shopId),
        );
        const value = context.items.reduce(
            (total, item) => total + Number(item.lineTotal),
            0,
        );
        const providerShipment = await this.provider.createShipment({
            orderId: context.orderId,
            orderNumber: context.orderNumber,
            shopId,
            pickupAddress,
            shippingAddress: shopAddress,
            items: context.items,
            value,
            codAmount: 0,
            shipmentKind: 'RETURN',
        });
        // Không cho phép phí thực tế rỗng ghi đè phí quote đã chốt; GHN phải trả total_fee cho vận đơn hoàn.
        // Nếu provider thiếu phí, hủy vận đơn vừa tạo để seller có thể thử lại mà không sinh dữ liệu lệch.
        if (
            !providerShipment.shippingFee ||
            Number(providerShipment.shippingFee) <= 0
        ) {
            await this.compensateProviderShipment(
                providerShipment.trackingId,
                'GHN không trả về chi phí vận chuyển hoàn hàng.',
            );
            throw new BadGatewayException(
                'GHN không trả về chi phí vận chuyển hoàn hàng.',
            );
        }
        // GHN trả total_fee theo đúng tuyến customer -> shop; hủy provider nếu Order Service không ghi nhận được chi phí.
        try {
            await this.orderClient.updateReturnShippingCost(
                returnRequestId,
                providerShipment.shippingFee ?? '0.00',
            );
        } catch (error) {
            await this.compensateProviderShipment(
                providerShipment.trackingId,
                'Order Service không ghi nhận được phí vận chuyển hoàn hàng.',
            );
            throw error;
        }
        let transition: { shipment: Shipment; event: ShipmentEvent };
        try {
            transition = await this.dataSource.transaction(async (manager) => {
                const shipmentRepository = manager.getRepository(Shipment);
                const eventRepository = manager.getRepository(ShipmentEvent);
                const shipment = shipmentRepository.create({
                    orderId: context.orderId,
                    orderNumber: context.orderNumber,
                    shopId,
                    shipmentKind: 'RETURN',
                    returnRequestId,
                    sellerUserId: currentUser.userId,
                    customerUserId: context.ownerId,
                    provider: GHN_PROVIDER,
                    providerOrderReference:
                        providerShipment.providerOrderReference,
                    providerTrackingId: providerShipment.trackingId,
                    providerStatusCode: providerShipment.providerStatusCode,
                    providerStatusText: providerShipment.providerStatusText,
                    lastProviderSyncedAt: new Date(),
                    pickupAddressSnapshot: { ...pickupAddress },
                    trackingCode: providerShipment.trackingId,
                    status: providerShipment.status,
                    currentLatitude: String(
                        providerShipment.currentLocation.latitude,
                    ),
                    currentLongitude: String(
                        providerShipment.currentLocation.longitude,
                    ),
                    currentLocationLabel:
                        providerShipment.currentLocation.label,
                    routePoints: providerShipment.routePoints,
                    estimatedDeliveryAt: providerShipment.estimatedDeliveryAt,
                });
                const saved = await shipmentRepository.save(shipment);
                const event = eventRepository.create({
                    shipmentId: saved.id,
                    providerEventKey: `create:return:${returnRequestId}`,
                    fromStatus: null,
                    toStatus: saved.status,
                    reason: 'Tạo vận đơn hoàn GHN Test thành công.',
                    latitude: saved.currentLatitude,
                    longitude: saved.currentLongitude,
                    locationLabel: saved.currentLocationLabel,
                    providerStatusCode: saved.providerStatusCode,
                    eventSource: 'SYSTEM',
                    occurredAt: new Date(),
                });
                await eventRepository.save(event);
                saved.events = [event];
                return { shipment: saved, event };
            });
        } catch (error) {
            // Transaction rollback làm mất shipment local, nên phải hủy GHN ngay để không để lại vận đơn mồ côi.
            await this.compensateProviderShipment(
                providerShipment.trackingId,
                'Lưu shipment hoàn local thất bại.',
            );
            throw error;
        }
        await this.events.publish(transition.shipment, transition.event);
        await this.orderClient.markReturnInTransit(returnRequestId);
        return this.toResponse(transition.shipment);
    }

    // Seller chỉ đọc shipment thuộc shop được resolve từ context hiện tại.
    async getForSeller(
        orderId: string,
        currentUser: CurrentSellerContext,
    ): Promise<ShipmentResponse> {
        this.ensureSellerContext(currentUser);
        const shopId = await this.sellerShopClient.getOwnedShopId(currentUser);
        const shipment = await this.repository.findByOrderAndShop(
            orderId,
            shopId,
        );
        if (!shipment)
            throw new NotFoundException(
                'Chưa có vận đơn của shop cho đơn hàng này.',
            );
        return this.toResponse(shipment);
    }

    // Làm mới trạng thái từ GHN theo đúng scope Seller.
    async refreshForSeller(
        orderId: string,
        currentUser: CurrentSellerContext,
    ): Promise<ShipmentResponse> {
        this.ensureSellerContext(currentUser);
        const shopId = await this.sellerShopClient.getOwnedShopId(currentUser);
        const shipment = await this.repository.findByOrderAndShop(
            orderId,
            shopId,
        );
        if (!shipment)
            throw new NotFoundException(
                'Chưa có vận đơn của shop cho đơn hàng này.',
            );
        return this.toResponse(await this.syncShipment(shipment.id, 'POLL'));
    }

    // Resolve entity đã kiểm tra shop scope để controller có thể tải label đúng shipment.
    async getSellerShipmentEntity(
        orderId: string,
        currentUser: CurrentSellerContext,
    ): Promise<Shipment> {
        this.ensureSellerContext(currentUser, true);
        const shopId = await this.sellerShopClient.getOwnedShopId(currentUser);
        const shipment = await this.repository
            .getEntityRepository()
            .findOne({ where: { orderId, shopId, shipmentKind: 'FORWARD' } });
        if (!shipment)
            throw new NotFoundException(
                'Chưa có vận đơn của shop cho đơn hàng này.',
            );
        return shipment;
    }

    // Seller hủy theo orderId nhưng scope shop vẫn do Seller Service resolve server-side.
    async cancelForSeller(
        orderId: string,
        currentUser: CurrentSellerContext,
        reason: string,
    ): Promise<ShipmentResponse> {
        this.ensureSellerContext(currentUser, true);
        const normalizedReason = reason?.trim();
        if (!normalizedReason) {
            throw new BadRequestException(
                'Seller phải nhập lý do hủy vận đơn.',
            );
        }
        const shopId = await this.sellerShopClient.getOwnedShopId(currentUser);
        const shipment = await this.getSellerShipmentEntity(
            orderId,
            currentUser,
        );
        return this.cancelInternal(shipment.id, normalizedReason, () =>
            this.orderClient.cancelSellerOrder(
                orderId,
                currentUser.userId,
                shopId,
                normalizedReason,
            ),
        );
    }

    // Chuyển một chặng demo theo state machine và lưu event để Seller có thể trình diễn sau khi refresh.
    async advanceDemoForSeller(
        orderId: string,
        currentUser: CurrentSellerContext,
    ): Promise<ShipmentResponse> {
        const shipment = await this.getSellerShipmentEntity(
            orderId,
            currentUser,
        );
        this.ensureDemoMode();
        const result = await this.advanceDemoShipment(
            shipment.id,
            DEMO_STATUS_SEQUENCE,
        );
        await this.events.publish(result.shipment, result.event);
        return this.toResponse(result.shipment);
    }

    // Customer chỉ được điều khiển reverse shipment thuộc order của mình; bước cuối đồng bộ request sang RECEIVED.
    async advanceDemoForCustomerReturn(
        returnRequestId: string,
        ownerId: string,
    ): Promise<ShipmentResponse> {
        if (!ownerId)
            throw new UnauthorizedException(
                'Bạn cần đăng nhập để mô phỏng hành trình hoàn hàng.',
            );
        const shipment =
            await this.repository.findByReturnRequest(returnRequestId);
        if (!shipment)
            throw new NotFoundException(
                'Chưa có vận đơn hoàn hàng để mô phỏng.',
            );
        if (
            shipment.shipmentKind !== 'RETURN' ||
            shipment.customerUserId !== ownerId
        )
            throw new ForbiddenException(
                'Bạn không có quyền mô phỏng vận đơn hoàn hàng này.',
            );
        await this.orderClient.assertCustomerOwnsOrder(
            shipment.orderId,
            ownerId,
        );
        if (
            shipment.status === ShipmentStatus.RETURNED &&
            shipment.returnRequestId
        ) {
            await this.orderClient.markReturnReceived(shipment.returnRequestId);
            return this.toResponse(shipment);
        }

        this.ensureDemoMode();
        const result = await this.advanceDemoShipment(
            shipment.id,
            DEMO_RETURN_STATUS_SEQUENCE,
        );
        await this.events.publish(result.shipment, result.event);
        if (
            result.shipment.status === ShipmentStatus.RETURNED &&
            result.shipment.returnRequestId
        ) {
            await this.orderClient.markReturnReceived(
                result.shipment.returnRequestId,
            );
        }
        return this.toResponse(result.shipment);
    }

    // Dùng chung transaction lock và event audit cho demo forward và demo reverse shipment.
    private async advanceDemoShipment(
        shipmentId: string,
        sequence: ShipmentStatus[],
    ): Promise<{ shipment: Shipment; event: ShipmentEvent }> {
        return this.dataSource.transaction(async (manager) => {
            const locked = await this.lockShipment(manager, shipmentId);
            const currentIndex = sequence.indexOf(locked.status);
            const nextStatus = sequence[currentIndex + 1];
            if (currentIndex < 0 || nextStatus === undefined)
                throw new ConflictException(
                    'Đơn demo không thể chuyển tiếp từ trạng thái hiện tại.',
                );

            // Shipment cũ có thể chứa route lỗi; chỉ dùng route đã chuẩn hóa để không ghi chuỗi vào cột numeric.
            const normalizedRoute = this.normalizeRoutePoints(
                locked.routePoints,
            );
            const routePoints =
                normalizedRoute && normalizedRoute.length >= sequence.length
                    ? normalizedRoute
                    : this.buildDemoRoute(locked);
            const currentPoint =
                routePoints[currentIndex + 1] ?? routePoints.at(-1);
            if (!currentPoint)
                throw new ConflictException(
                    'Shipment chưa có dữ liệu lộ trình demo.',
                );
            locked.routePoints = routePoints;
            locked.status = nextStatus;
            locked.providerStatusCode = null;
            locked.providerStatusText = `DEMO · ${STATUS_LABELS[nextStatus]}`;
            locked.currentLatitude = String(currentPoint.latitude);
            locked.currentLongitude = String(currentPoint.longitude);
            locked.currentLocationLabel = currentPoint.label;
            locked.lastProviderSyncedAt = new Date();
            const saved = await manager.getRepository(Shipment).save(locked);
            const event = manager.getRepository(ShipmentEvent).create({
                shipmentId: saved.id,
                providerEventKey: `demo:${saved.id}:${nextStatus}:${Date.now()}`,
                fromStatus: locked.events.at(-1)?.toStatus ?? null,
                toStatus: nextStatus,
                reason: DEMO_STATUS_REASONS[nextStatus],
                latitude: saved.currentLatitude,
                longitude: saved.currentLongitude,
                locationLabel: saved.currentLocationLabel,
                providerStatusCode: null,
                eventSource: 'SYSTEM',
                occurredAt: new Date(),
            });
            await manager.getRepository(ShipmentEvent).save(event);
            saved.events = [...locked.events, event];
            return { shipment: saved, event };
        });
    }

    // Customer chỉ nhận tracking sau khi Order Service xác nhận ownership.
    async getForCustomer(
        orderId: string,
        ownerId: string,
    ): Promise<CustomerTrackingResponse> {
        if (!ownerId)
            throw new UnauthorizedException(
                'Bạn cần đăng nhập để xem hành trình đơn hàng.',
            );
        await this.orderClient.assertCustomerOwnsOrder(orderId, ownerId);
        const shipments = await this.repository.findByOrder(orderId);
        return {
            orderId,
            shipments: shipments.map((shipment) => this.toResponse(shipment)),
        };
    }

    // Internal orchestration chỉ dùng shipmentId sau khi controller đã xác thực shared token.
    async getInternal(shipmentId: string): Promise<ShipmentResponse> {
        const shipment = await this.repository.getEntityRepository().findOne({
            where: { id: shipmentId },
            relations: { events: true },
        });
        if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn.');
        return this.toResponse(shipment);
    }

    // Internal worker sync dùng chung applyProviderUpdate với webhook.
    async syncInternal(shipmentId: string): Promise<ShipmentResponse> {
        return this.toResponse(await this.syncShipment(shipmentId, 'POLL'));
    }

    // Hủy ở provider trước, sau đó commit canonical state của Shipping trong transaction local.
    // Chỉ sau khi transaction resolve mới gọi callback đồng bộ Order để Order không xử lý trước khi Shipping ghi nhận hủy.
    // Nếu callback lỗi, shipment đã CANCELLED nên lần retry sẽ bỏ qua GHN và thử đồng bộ Order lại một cách idempotent.
    async cancelInternal(
        shipmentId: string,
        reason = 'Hủy vận đơn trước khi lấy hàng.',
        afterLocalCancellationCommit?: () => Promise<void>,
    ): Promise<ShipmentResponse> {
        const shipment = await this.repository
            .getEntityRepository()
            .findOne({ where: { id: shipmentId } });
        if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn.');
        if (shipment.status === ShipmentStatus.CANCELLED) {
            await this.syncOrderAfterCancellation(afterLocalCancellationCommit);
            return this.toResponse(shipment);
        }
        if (
            ![
                ShipmentStatus.READY_TO_SHIP,
                ShipmentStatus.PICKUP_ASSIGNED,
            ].includes(shipment.status)
        ) {
            throw new ConflictException(
                'Chỉ có thể hủy vận đơn trước khi GHN lấy hàng.',
            );
        }
        await this.provider.cancelShipment(shipment.providerTrackingId);
        const transition = await this.dataSource.transaction(
            async (manager) => {
                const locked = await this.lockShipment(manager, shipmentId);
                if (locked.status === ShipmentStatus.CANCELLED)
                    return { shipment: locked, event: locked.events.at(-1) };
                if (
                    ![
                        ShipmentStatus.READY_TO_SHIP,
                        ShipmentStatus.PICKUP_ASSIGNED,
                    ].includes(locked.status)
                ) {
                    throw new ConflictException(
                        'Vận đơn vừa được GHN lấy hàng, không thể hủy.',
                    );
                }
                const previousStatus = locked.status;
                locked.status = ShipmentStatus.CANCELLED;
                locked.providerStatusCode = -1;
                locked.providerStatusText = 'Đã hủy';
                locked.lastProviderSyncedAt = new Date();
                const saved = await manager
                    .getRepository(Shipment)
                    .save(locked);
                const event = manager.getRepository(ShipmentEvent).create({
                    shipmentId: saved.id,
                    providerEventKey: `cancel:${saved.providerTrackingId}:${Date.now()}`,
                    fromStatus: previousStatus,
                    toStatus: ShipmentStatus.CANCELLED,
                    reason,
                    latitude: saved.currentLatitude,
                    longitude: saved.currentLongitude,
                    locationLabel: saved.currentLocationLabel,
                    providerStatusCode: -1,
                    eventSource: 'SYSTEM',
                    occurredAt: new Date(),
                });
                await manager.getRepository(ShipmentEvent).save(event);
                saved.events = [...locked.events, event];
                return { shipment: saved, event };
            },
        );
        // Promise transaction chỉ hoàn tất sau khi TypeORM commit thành công; lúc này Order mới được phép hoàn tồn kho.
        await this.syncOrderAfterCancellation(afterLocalCancellationCommit);
        if (transition.event)
            await this.events.publish(transition.shipment, transition.event);
        return this.toResponse(transition.shipment);
    }

    // Đồng bộ Order sau commit local; giữ lỗi để caller retry vì nếu nuốt lỗi sẽ tạo shipment hủy nhưng tồn kho chưa hoàn.
    private async syncOrderAfterCancellation(
        callback?: () => Promise<void>,
    ): Promise<void> {
        if (!callback) return;
        try {
            await callback();
        } catch (error) {
            this.logger.error(
                'Shipping đã commit hủy vận đơn nhưng chưa đồng bộ được Order Service.',
                error instanceof Error ? error.stack : String(error),
            );
            throw error;
        }
    }

    // Compensation cho provider khi transaction local rollback sau lúc GHN đã tạo vận đơn.
    // Không nuốt lỗi hủy provider trong log để đội vận hành có thể truy vết và retry khi GHN tạm thời lỗi.
    private async compensateProviderShipment(
        trackingId: string,
        failureReason: string,
    ): Promise<void> {
        try {
            await this.provider.cancelShipment(trackingId);
        } catch (error) {
            this.logger.error(
                `Không thể compensation vận đơn GHN sau lỗi: ${failureReason}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    // In nhãn Test qua provider, không expose token hay URL GHN cho browser.
    async printLabel(shipmentId: string) {
        const shipment = await this.repository
            .getEntityRepository()
            .findOne({ where: { id: shipmentId } });
        if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn.');
        return this.provider.printLabel(shipment.providerTrackingId);
    }

    // Webhook GHN là JSON callback; service parse và đồng bộ event idempotent.
    async handleWebhook(body: Record<string, unknown>): Promise<void> {
        const providerTrackingId = this.text(body.OrderCode);
        const partnerReference = this.text(body.ClientOrderCode);
        const statusText = this.text(body.Status);
        if (!providerTrackingId || !statusText) {
            this.logger.warn(
                'GHN webhook hợp lệ nhưng thiếu OrderCode/Status.',
            );
            return;
        }
        const shipment = await this.repository.getEntityRepository().findOne({
            where: [
                { providerTrackingId: providerTrackingId },
                ...(partnerReference
                    ? [{ providerOrderReference: partnerReference }]
                    : []),
            ],
        });
        if (!shipment) {
            this.logger.warn(
                `Không tìm thấy shipment cho webhook GHN ${providerTrackingId}.`,
            );
            return;
        }
        const occurredAt = this.date(body.Time) ?? new Date();
        await this.applyProviderUpdate(
            shipment.id,
            {
                trackingId:
                    this.text(body.label_id) ?? shipment.providerTrackingId,
                providerOrderReference: partnerReference,
                providerStatusCode: null,
                providerStatusText: statusText,
                status: null,
                currentLocation: null,
                estimatedDeliveryAt: null,
                occurredAt,
                reason: this.text(body.Reason) ?? statusText,
            },
            'WEBHOOK',
            `webhook:${providerTrackingId}:${statusText}:${occurredAt.toISOString()}`,
        );
    }

    // Polling định kỳ thay cho seller advance/auto simulation; shipment terminal không được gọi provider.
    @Interval(60_000)
    async syncActiveShipments(): Promise<void> {
        const candidates = await this.repository.findSyncCandidates(
            new Date(),
            60_000,
        );
        await Promise.allSettled(
            candidates.map((shipment) =>
                this.syncShipment(shipment.id, 'POLL'),
            ),
        );
    }

    // Gọi tracking rồi dùng chung applyProviderUpdate với webhook để không có hai state machine.
    private async syncShipment(
        shipmentId: string,
        source: EventSource,
    ): Promise<Shipment> {
        const current = await this.repository
            .getEntityRepository()
            .findOne({ where: { id: shipmentId } });
        if (!current) throw new NotFoundException('Không tìm thấy vận đơn.');
        if (this.isDemoShipment(current)) return current;
        const providerUpdate = await this.provider.getShipment(
            current.providerTrackingId,
        );
        return this.applyProviderUpdate(
            shipmentId,
            providerUpdate,
            source,
            `poll:${providerUpdate.trackingId}:${providerUpdate.providerStatusCode ?? 'unknown'}:${providerUpdate.occurredAt.toISOString()}`,
        );
    }

    // Lock row, cập nhật metadata provider và chỉ chuyển canonical state theo transition hợp lệ.
    private async applyProviderUpdate(
        shipmentId: string,
        update: ProviderShipmentStatus,
        source: EventSource,
        eventKey: string,
    ): Promise<Shipment> {
        const result = await this.dataSource.transaction(async (manager) => {
            const shipment = await this.lockShipment(manager, shipmentId);
            const eventRepository = manager.getRepository(ShipmentEvent);
            const previousStatus = shipment.status;
            const nextStatus =
                update.status &&
                this.canTransition(
                    previousStatus,
                    update.status,
                    shipment.shipmentKind,
                )
                    ? update.status
                    : previousStatus;
            shipment.providerTrackingId =
                update.trackingId || shipment.providerTrackingId;
            shipment.trackingCode = shipment.providerTrackingId;
            shipment.providerOrderReference =
                update.providerOrderReference ??
                shipment.providerOrderReference;
            shipment.providerStatusCode = update.providerStatusCode;
            shipment.providerStatusText = update.providerStatusText;
            shipment.lastProviderSyncedAt = new Date();
            shipment.status = nextStatus;
            if (update.currentLocation) {
                shipment.currentLatitude = String(
                    update.currentLocation.latitude,
                );
                shipment.currentLongitude = String(
                    update.currentLocation.longitude,
                );
                shipment.currentLocationLabel = update.currentLocation.label;
            }
            if (update.routePoints?.length)
                shipment.routePoints = update.routePoints;
            if (update.estimatedDeliveryAt)
                shipment.estimatedDeliveryAt = update.estimatedDeliveryAt;
            const saved = await manager.getRepository(Shipment).save(shipment);
            const duplicate = await eventRepository.findOne({
                where: { providerEventKey: eventKey },
            });
            if (duplicate)
                return { shipment: saved, event: null as ShipmentEvent | null };
            const event = eventRepository.create({
                shipmentId,
                providerEventKey: eventKey,
                fromStatus:
                    previousStatus === nextStatus ? null : previousStatus,
                toStatus: nextStatus,
                reason: update.reason ?? update.providerStatusText,
                latitude: saved.currentLatitude,
                longitude: saved.currentLongitude,
                locationLabel: saved.currentLocationLabel,
                providerStatusCode: update.providerStatusCode,
                eventSource: source,
                occurredAt: update.occurredAt,
            });
            try {
                await eventRepository.save(event);
            } catch (error) {
                // Hai webhook/poll chạy đồng thời có thể cùng qua findOne; unique key là lớp chống trùng cuối cùng.
                if (
                    error instanceof QueryFailedError &&
                    (error.driverError as { code?: string } | undefined)
                        ?.code === '23505'
                ) {
                    return {
                        shipment: saved,
                        event: null as ShipmentEvent | null,
                    };
                }
                throw error;
            }
            saved.events = [...shipment.events, event];
            return { shipment: saved, event };
        });
        if (result.event)
            await this.events.publish(result.shipment, result.event);
        if (
            result.shipment.shipmentKind === 'RETURN' &&
            result.shipment.returnRequestId
        ) {
            // Đồng bộ từng mốc reverse shipment để Order Service không bị kẹt ở
            // AWAITING_SHIPMENT khi callback sau lúc tạo vận đơn bị gián đoạn.
            if (result.shipment.status === ShipmentStatus.RETURNING) {
                await this.orderClient.markReturnInTransit(
                    result.shipment.returnRequestId,
                );
            }
            if (result.shipment.status === ShipmentStatus.RETURNED) {
                await this.orderClient.markReturnReceived(
                    result.shipment.returnRequestId,
                );
            }
        }
        return result.shipment;
    }

    // State machine giữ nguyên tính đơn điệu cho từng chiều vận chuyển; reverse
    // shipment dùng RETURN_STATUS_RANK để RETURNING/RETURNED được xử lý độc lập
    // với các trạng thái kết thúc của forward shipment.
    private canTransition(
        current: ShipmentStatus,
        next: ShipmentStatus,
        shipmentKind: 'FORWARD' | 'RETURN' = 'FORWARD',
    ): boolean {
        if (current === next) return true;
        if (
            [ShipmentStatus.CANCELLED, ShipmentStatus.RETURNED].includes(
                current,
            )
        )
            return false;
        if (shipmentKind === 'FORWARD' && current === ShipmentStatus.DELIVERED)
            return [ShipmentStatus.RETURNING, ShipmentStatus.RETURNED].includes(
                next,
            );
        if (shipmentKind === 'FORWARD' && current === ShipmentStatus.RETURNING)
            return next === ShipmentStatus.RETURNED;
        if (next === ShipmentStatus.CANCELLED) {
            return [
                ShipmentStatus.READY_TO_SHIP,
                ShipmentStatus.PICKUP_ASSIGNED,
            ].includes(current);
        }
        if (current === ShipmentStatus.FAILED) return false;
        if (next === ShipmentStatus.FAILED) return ACTIVE_STATUSES.has(current);
        const statusRank =
            shipmentKind === 'RETURN'
                ? RETURN_STATUS_RANK
                : FORWARD_STATUS_RANK;
        const currentRank = statusRank[current];
        const nextRank = statusRank[next];
        return (
            currentRank !== undefined &&
            nextRank !== undefined &&
            nextRank > currentRank
        );
    }

    // GHN cần toàn bộ package snapshot; không dùng giá trị mặc định khiến phí/vận đơn sai.
    private validatePackageContext(order: ShippingOrderContext): void {
        if (!order.items.length)
            throw new BadRequestException(
                'Đơn hàng không có sản phẩm để tạo vận đơn.',
            );
        for (const item of order.items) {
            if (
                ![
                    item.packageWeightGrams,
                    item.packageLengthCm,
                    item.packageWidthCm,
                    item.packageHeightCm,
                ].every((value) => Number.isFinite(value) && value > 0)
            ) {
                throw new BadRequestException(
                    'Sản phẩm chưa đủ thông tin đóng gói để tạo vận đơn.',
                );
            }
        }
    }

    // Khóa riêng shipment trước khi đọc events để PostgreSQL không khóa nhầm nullable LEFT JOIN.
    private async lockShipment(
        manager: EntityManager,
        shipmentId: string,
    ): Promise<Shipment> {
        const shipment = await manager
            .getRepository(Shipment)
            .createQueryBuilder('shipment')
            .where('shipment.id = :shipmentId', { shipmentId })
            .setLock('pessimistic_write')
            .getOne();
        if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn.');
        shipment.events = await manager.getRepository(ShipmentEvent).find({
            where: { shipmentId },
            order: { occurredAt: 'ASC', id: 'ASC' },
        });
        return shipment;
    }

    // Seller permission và user context phải hợp lệ trước mọi thao tác shipment.
    private ensureSellerContext(
        currentUser: CurrentSellerContext,
        requiresManage = false,
    ): void {
        if (!currentUser.userId || !currentUser.email)
            throw new UnauthorizedException(
                'Bạn cần đăng nhập để quản lý vận đơn.',
            );
        const canRead =
            currentUser.permissions.includes('seller.shipping.read') ||
            currentUser.permissions.includes('seller.shipping.manage');
        const canManage = currentUser.permissions.includes(
            'seller.shipping.manage',
        );
        if (!canRead || (requiresManage && !canManage))
            throw new ForbiddenException(
                'Bạn không có quyền quản lý vận đơn của shop.',
            );
    }

    // Chỉ cho phép nút bỏ qua trong môi trường GHN Test để không thể tự chuyển trạng thái đơn thật.
    private ensureDemoMode(): void {
        const nodeEnvironment = this.config
            .get<string>('NODE_ENV', 'development')
            .trim()
            .toLowerCase();
        const baseUrl = this.config
            .get<string>('GHN_BASE_URL', 'https://dev-online-gateway.ghn.vn')
            .replace(/\/$/, '');
        const enabled =
            this.config
                .get<string>('SHIPPING_DEMO_MODE', 'true')
                .trim()
                .toLowerCase() === 'true';
        if (
            !enabled ||
            nodeEnvironment === 'production' ||
            baseUrl !== 'https://dev-online-gateway.ghn.vn'
        ) {
            throw new ForbiddenException(
                'Chức năng bỏ qua bước chỉ có trong môi trường GHN Test.',
            );
        }
    }

    // Không để polling GHN ghi đè trạng thái demo trước khi Seller kịp trình bày xong luồng.
    private isDemoShipment(shipment: Shipment): boolean {
        return shipment.providerStatusText?.startsWith('DEMO ·') ?? false;
    }

    // Tạo fallback route cho shipment cũ chưa có đủ các điểm minh họa trong database.
    private buildDemoRoute(
        shipment: Shipment,
    ): Array<{ latitude: number; longitude: number; label: string }> {
        const latitude = this.number(shipment.currentLatitude) ?? 10.7769;
        const longitude = this.number(shipment.currentLongitude) ?? 106.7009;
        return [
            { latitude, longitude, label: 'Shop · Điểm lấy hàng' },
            {
                latitude: latitude - 0.0038,
                longitude: longitude + 0.0062,
                label: 'Trạm GHN · Đã tiếp nhận',
            },
            {
                latitude: latitude - 0.0094,
                longitude: longitude + 0.0028,
                label: 'Kho trung chuyển · Đang luân chuyển',
            },
            {
                latitude: latitude - 0.0065,
                longitude: longitude + 0.0138,
                label: 'Khu vực giao · Shipper đang giao',
            },
            {
                latitude: latitude - 0.0017,
                longitude: longitude + 0.0182,
                label: 'Điểm nhận · Giao thành công',
            },
        ];
    }

    // Kiểm tra và chuẩn hóa route JSON trước khi route được dùng để cập nhật shipment hoặc trả về API.
    private normalizeRoutePoints(
        value: unknown,
    ): Array<{ latitude: number; longitude: number; label: string }> | null {
        if (!Array.isArray(value)) return null;
        const points = value.map((candidate) => {
            if (!candidate || typeof candidate !== 'object') return null;
            const point = candidate as Record<string, unknown>;
            const latitude = this.number(point.latitude);
            const longitude = this.number(point.longitude);
            const label = this.text(point.label);
            if (latitude === null || longitude === null || !label) return null;
            return { latitude, longitude, label };
        });
        return points.every((point) => point !== null)
            ? points.filter(
                  (
                      point,
                  ): point is {
                      latitude: number;
                      longitude: number;
                      label: string;
                  } => point !== null,
              )
            : null;
    }

    // Partner reference chỉ chứa ký tự an toàn và giữ ổn định qua retry timeout.
    private providerOrderReference(
        orderNumber: string,
        shopId: string,
    ): string {
        return `BIN-${orderNumber.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 180)}-${shopId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50)}`.slice(
            0,
            250,
        );
    }

    // Chuyển pickup address đã chuẩn hóa của Seller thành contract GHN từ mã master data đã lưu.
    private toShippingAddress(
        input: SellerPickupAddressResponse,
    ): ShippingOrderContext['shippingAddress'] {
        if (
            !input.ghnProvinceId ||
            !input.ghnProvinceName ||
            !input.ghnDistrictId ||
            !input.ghnDistrictName ||
            !input.ghnWardCode ||
            !input.ghnWardName
        ) {
            throw new BadRequestException(
                'Kho lấy hàng mặc định chưa đủ mã địa chỉ GHN.',
            );
        }
        return {
            contactName: input.contactName,
            phone: input.phone,
            addressLine: input.addressLine,
            province: input.ghnProvinceName,
            district: input.ghnDistrictName,
            ward: input.ghnWardName,
            ghnAddress: {
                provinceId: input.ghnProvinceId,
                districtId: input.ghnDistrictId,
                wardCode: input.ghnWardCode,
                districtName: input.ghnDistrictName,
                wardName: input.ghnWardName,
            },
        };
    }

    // Chuẩn hóa snapshot địa chỉ customer về contract GHN; địa chỉ được chụp từ order, không đọc lại profile hiện tại.
    private toCustomerAddress(
        input: Record<string, unknown>,
    ): ShippingOrderContext['shippingAddress'] {
        const address = {
            contactName: String(
                input.contactName ?? input.fullName ?? 'Người nhận',
            ),
            phone: String(input.phone ?? ''),
            addressLine: String(input.addressLine ?? input.street ?? ''),
            province: String(input.province ?? input.ghnProvinceName ?? ''),
            district: String(input.district ?? input.ghnDistrictName ?? ''),
            ward: String(input.ward ?? input.ghnWardName ?? ''),
            ghnAddress:
                input.ghnAddress as ShippingOrderContext['shippingAddress']['ghnAddress'],
        };
        return this.ensureDestination(address);
    }

    // Chỉ cho quote và create shipment đi tiếp khi destination có đủ mã GHN đã chọn từ frontend.
    private ensureDestination(
        input: ShippingOrderContext['shippingAddress'],
    ): ShippingOrderContext['shippingAddress'] {
        const selection = input.ghnAddress;
        if (
            !input.province.trim() ||
            !input.district.trim() ||
            !input.ward.trim() ||
            !selection?.provinceId ||
            !selection.districtId ||
            !selection.wardCode
        ) {
            throw new BadRequestException(
                'Địa chỉ giao hàng cần đủ tỉnh/thành phố, quận/huyện và phường/xã GHN.',
            );
        }
        return input;
    }

    private text(value: unknown): string | null {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    private number(value: unknown): number | null {
        const result = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(result) ? result : null;
    }

    private date(value: unknown): Date | null {
        if (typeof value !== 'string' || !value.trim()) return null;
        const result = new Date(value);
        return Number.isNaN(result.getTime()) ? null : result;
    }

    // Map entity sang response mà không lộ shop scope hoặc pickup snapshot riêng của shop khác.
    private toResponse(shipment: Shipment): ShipmentResponse {
        return {
            id: shipment.id,
            orderId: shipment.orderId,
            shipmentKind: shipment.shipmentKind,
            returnRequestId: shipment.returnRequestId,
            provider: GHN_PROVIDER,
            trackingCode: shipment.providerTrackingId,
            providerStatusCode: shipment.providerStatusCode,
            providerStatusText: shipment.providerStatusText,
            status: shipment.status,
            statusLabel: STATUS_LABELS[shipment.status],
            currentLocation: {
                latitude: Number(shipment.currentLatitude),
                longitude: Number(shipment.currentLongitude),
                label: shipment.currentLocationLabel,
            },
            routePoints:
                this.normalizeRoutePoints(shipment.routePoints) ??
                this.buildDemoRoute(shipment),
            mapMode: 'INTERNAL_PRESENTATION',
            trackingSource: 'GHN_TEST',
            demoMode: this.isDemoShipment(shipment),
            estimatedDeliveryAt:
                shipment.estimatedDeliveryAt?.toISOString() ?? null,
            history: [...(shipment.events ?? [])]
                .sort(
                    (left, right) =>
                        left.occurredAt.getTime() - right.occurredAt.getTime(),
                )
                .map((event) => ({
                    id: event.id,
                    fromStatus: event.fromStatus,
                    toStatus: event.toStatus,
                    reason: event.reason,
                    locationLabel: event.locationLabel,
                    occurredAt: event.occurredAt.toISOString(),
                })),
            createdAt: shipment.createdAt.toISOString(),
            updatedAt: shipment.updatedAt.toISOString(),
        };
    }
}
