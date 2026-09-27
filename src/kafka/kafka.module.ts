// Module hạ tầng Kafka của Shipping Service.
// Module chỉ export publisher cần cho bounded context; chi tiết broker và kafkajs được giữ bên trong module.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentStatusEventOutboxEntity } from '@/database/entities/shipment-status-event-outbox.entity';
import { KafkaProducerService } from '@/kafka/kafka-producer.service';
import { ShipmentEventsPublisher } from '@/kafka/shipment-events.publisher';

// Đăng ký Kafka producer một lần và cung cấp publisher shipment qua DI.
@Module({
    imports: [TypeOrmModule.forFeature([ShipmentStatusEventOutboxEntity])],
    providers: [KafkaProducerService, ShipmentEventsPublisher],
    exports: [ShipmentEventsPublisher],
})
export class KafkaModule {}
