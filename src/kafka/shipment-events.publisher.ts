// Publisher chuyển shipment event nội bộ thành integration event cho Notification/Order.
// File này sở hữu mapping payload shipment, nhưng không quản lý connection hoặc retry của Kafka.

import { Injectable } from "@nestjs/common";
import { Shipment } from "../database/entities/shipment.entity";
import { ShipmentEvent } from "../database/entities/shipment-event.entity";
import { KafkaProducerService } from "./kafka-producer.service";

export const SHIPMENT_STATUS_UPDATED = "shipment.status.updated";

// Đóng gói event shipment để consumer không phụ thuộc TypeORM entity hoặc private database fields.
@Injectable()
export class ShipmentEventsPublisher {
  // Publisher chỉ phụ thuộc abstraction Kafka producer, không khởi tạo kafkajs trực tiếp.
  constructor(private readonly kafkaProducer: KafkaProducerService) {}

  // Publish sau transaction commit theo shipment key để event cùng shipment giữ đúng thứ tự partition.
  async publish(shipment: Shipment, event: ShipmentEvent): Promise<void> {
    const payload = {
      eventId: event.providerEventKey,
      eventName: SHIPMENT_STATUS_UPDATED,
      eventVersion: 1,
      source: "shipping-service",
      aggregateId: shipment.id,
      occurredAt: event.occurredAt.toISOString(),
      data: {
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        shipmentKind: shipment.shipmentKind,
        returnRequestId: shipment.returnRequestId,
        orderNumber: shipment.orderNumber,
        shopId: shipment.shopId,
        statusLabel: this.statusLabel(event.toStatus),
        sellerUserId: shipment.sellerUserId,
        customerUserId: shipment.customerUserId,
        trackingCode: shipment.providerTrackingId,
        status: event.toStatus,
        providerStatusCode: event.providerStatusCode,
        currentLocation: {
          latitude: Number(shipment.currentLatitude),
          longitude: Number(shipment.currentLongitude),
          label: shipment.currentLocationLabel,
        },
      },
    };

    await this.kafkaProducer.publish(SHIPMENT_STATUS_UPDATED, shipment.id, payload);
  }

  // Notification Service chỉ cần label ổn định, không phụ thuộc enum kỹ thuật từ consumer.
  private statusLabel(status: string): string {
    const labels: Record<string, string> = {
      READY_TO_SHIP: "Shop đang chuẩn bị hàng",
      PICKUP_ASSIGNED: "Đã phân công lấy hàng",
      PICKED_UP: "Đơn vị vận chuyển đã lấy hàng",
      IN_TRANSIT: "Đang trên đường giao",
      DELIVERED: "Giao hàng thành công",
      FAILED: "Giao hàng thất bại",
      CANCELLED: "Vận đơn đã hủy",
      RETURNING: "Đang hoàn hàng",
      RETURNED: "Đã hoàn hàng",
    };
    return labels[status] ?? "Có cập nhật mới";
  }
}
