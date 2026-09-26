// Đăng ký bounded context giao nhận và adapter GHN Test duy nhất.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from '@/database/entities/shipment.entity';
import { ShipmentEvent } from '@/database/entities/shipment-event.entity';
import { CustomerShipmentController } from '@/modules/shipping/presentation/controllers/customer-shipment.controller';
import { InternalShipmentController } from '@/modules/shipping/presentation/controllers/internal-shipment.controller';
import { SellerShipmentController } from '@/modules/shipping/presentation/controllers/seller-shipment.controller';
import { GhnWebhookController } from '@/modules/shipping/presentation/controllers/ghn-webhook.controller';
import { GhnLocationController } from '@/modules/shipping/presentation/controllers/ghn-location.controller';
import { OrderClient } from '@/modules/shipping/application/clients/order.client';
import { SellerShopClient } from '@/modules/shipping/application/clients/seller-shop.client';
import { GhnMasterDataClient } from '@/modules/shipping/application/clients/ghn-master-data.client';
import { GhnTestProvider } from '@/modules/shipping/application/providers/ghn-test.provider';
import { SHIPPING_PROVIDER } from '@/modules/shipping/application/types/shipping.types';
import { ShipmentRepository } from '@/modules/shipping/infrastructure/repositories/shipment.repository';
import { ShippingService } from '@/modules/shipping/application/services/shipping.service';
import { KafkaModule } from '@/kafka/kafka.module';

@Module({
    imports: [TypeOrmModule.forFeature([Shipment, ShipmentEvent]), KafkaModule],
    controllers: [
        SellerShipmentController,
        CustomerShipmentController,
        InternalShipmentController,
        GhnWebhookController,
        GhnLocationController,
    ],
    providers: [
        ShipmentRepository,
        GhnTestProvider,
        { provide: SHIPPING_PROVIDER, useExisting: GhnTestProvider },
        OrderClient,
        SellerShopClient,
        GhnMasterDataClient,
        ShippingService,
    ],
    exports: [ShippingService],
})
export class ShippingModule {}
