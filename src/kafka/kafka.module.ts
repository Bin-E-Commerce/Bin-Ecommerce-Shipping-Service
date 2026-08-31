// Module hạ tầng Kafka của Shipping Service.
// Module chỉ export publisher cần cho bounded context; chi tiết broker và kafkajs được giữ bên trong module.

import { Module } from "@nestjs/common";
import { KafkaProducerService } from "./kafka-producer.service";
import { ShipmentEventsPublisher } from "./shipment-events.publisher";

// Đăng ký Kafka producer một lần và cung cấp publisher shipment qua DI.
@Module({
  providers: [KafkaProducerService, ShipmentEventsPublisher],
  exports: [ShipmentEventsPublisher],
})
export class KafkaModule {}
