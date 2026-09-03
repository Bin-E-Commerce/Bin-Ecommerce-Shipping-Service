// Đăng ký bounded context giao nhận và adapter GHN Test duy nhất.

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Shipment } from "../../database/entities/shipment.entity";
import { ShipmentEvent } from "../../database/entities/shipment-event.entity";
import { CustomerShipmentController } from "./presentation/controllers/customer-shipment.controller";
import { InternalShipmentController } from "./presentation/controllers/internal-shipment.controller";
import { SellerShipmentController } from "./presentation/controllers/seller-shipment.controller";
import { GhnWebhookController } from "./presentation/controllers/ghn-webhook.controller";
import { GhnLocationController } from "./presentation/controllers/ghn-location.controller";
import { OrderClient } from "./application/clients/order.client";
import { SellerShopClient } from "./application/clients/seller-shop.client";
import { GhnMasterDataClient } from "./application/clients/ghn-master-data.client";
import { GhnTestProvider } from "./application/providers/ghn-test.provider";
import { SHIPPING_PROVIDER } from "./application/types/shipping.types";
import { ShipmentRepository } from "./infrastructure/repositories/shipment.repository";
import { ShippingService } from "./application/services/shipping.service";
import { KafkaModule } from "../../kafka/kafka.module";

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
