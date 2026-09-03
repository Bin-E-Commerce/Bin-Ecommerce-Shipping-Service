// Truy vấn shipment theo scope đã được application service xác minh.

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Shipment } from "../../../../database/entities/shipment.entity";
import { ShipmentEvent } from "../../../../database/entities/shipment-event.entity";
import { ShipmentStatus } from "../../../../database/enums/shipment-status.enum";

@Injectable()
export class ShipmentRepository {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ShipmentEvent)
    private readonly eventRepository: Repository<ShipmentEvent>,
  ) {}

  // Tìm shipment theo shop để tạo idempotent và không đọc nhầm shipment shop khác.
  findByOrderAndShop(
    orderId: string,
    shopId: string,
  ): Promise<Shipment | null> {
    return this.shipmentRepository.findOne({
      where: { orderId, shopId, shipmentKind: "FORWARD" },
      relations: { events: true },
      order: { events: { occurredAt: "ASC" } },
    });
  }

  // Customer cần toàn bộ shipment của order để hiển thị đơn nhiều shop trên cùng một màn hình.
  findByOrder(orderId: string): Promise<Shipment[]> {
    return this.shipmentRepository.find({
      where: { orderId },
      relations: { events: true },
      order: { createdAt: "ASC", events: { occurredAt: "ASC" } },
    });
  }

  // Tìm shipment hoàn theo return request để retry không tạo thêm vận đơn.
  findByReturnRequest(returnRequestId: string): Promise<Shipment | null> {
    return this.shipmentRepository.findOne({
      where: { returnRequestId, shipmentKind: "RETURN" },
      relations: { events: true },
      order: { events: { occurredAt: "ASC" } },
    });
  }

  // Polling chỉ lấy shipment active đã quá thời gian đồng bộ; trạng thái terminal không tạo request thừa.
  findSyncCandidates(now: Date, staleAfterMs: number): Promise<Shipment[]> {
    const staleAt = new Date(now.getTime() - staleAfterMs);
    return this.shipmentRepository
      .createQueryBuilder("shipment")
      .where(
        "(shipment.last_provider_synced_at IS NULL OR shipment.last_provider_synced_at <= :staleAt)",
        { staleAt },
      )
      .andWhere("shipment.status IN (:...statuses)", {
        statuses: [
          ShipmentStatus.READY_TO_SHIP,
          ShipmentStatus.PICKUP_ASSIGNED,
          ShipmentStatus.PICKED_UP,
          ShipmentStatus.IN_TRANSIT,
          ShipmentStatus.RETURNING,
        ],
      })
      .take(50)
      .getMany();
  }

  // Trả repository gốc cho transaction lock ở application service.
  getEntityRepository(): Repository<Shipment> {
    return this.shipmentRepository;
  }

  // Tạo history record cùng transaction với shipment transition.
  createEvent(input: Partial<ShipmentEvent>): ShipmentEvent {
    return this.eventRepository.create(input);
  }

  // Trả repository history để transaction insert event append-only.
  getEventRepository(): Repository<ShipmentEvent> {
    return this.eventRepository;
  }
}
