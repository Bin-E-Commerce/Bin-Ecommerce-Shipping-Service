// Đăng ký bounded context giao nhận và adapter GHN Test duy nhất.

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Shipment } from "../../database/entities/shipment.entity";
import { ShipmentEvent } from "../../database/entities/shipment-event.entity";
import { CustomerShipmentController } from "./controllers/customer-shipment.controller";
import { InternalShipmentController } from "./controllers/internal-shipment.controller";
import { SellerShipmentController } from "./controllers/seller-shipment.controller";
import { GhnWebhookController } from "./controllers/ghn-webhook.controller";
import { GhnLocationController } from "./controllers/ghn-location.controller";
import { OrderClient } from "./clients/order.client";
import { SellerShopClient } from "./clients/seller-shop.client";
import { GhnMasterDataClient } from "./clients/ghn-master-data.client";
import { GhnTestProvider } from "./providers/ghn-test.provider";
import { SHIPPING_PROVIDER } from "./types/shipping.types";
import { ShipmentRepository } from "./repositories/shipment.repository";
import { ShippingService } from "./services/shipping.service";
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
