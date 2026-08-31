// Entity persistence lưu append-only history của shipment và khóa webhook/polling bằng providerEventKey.
// Entity không tự chuyển trạng thái; mọi transition phải đi qua ShippingService.

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ShipmentStatus } from "../enums/shipment-status.enum";
import { Shipment } from "./shipment.entity";

// Map bảng shipment_events và quan hệ ngược về aggregate Shipment.
@Entity({ name: "shipment_events" })
@Index("uq_shipment_events_provider_key", ["providerEventKey"], {
  unique: true,
})
@Index("idx_shipment_events_shipment_occurred", ["shipmentId", "occurredAt"])
export class ShipmentEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "shipment_id", type: "uuid" })
  shipmentId!: string;

  @ManyToOne(() => Shipment, (shipment) => shipment.events, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "shipment_id" })
  shipment!: Shipment;

  @Column({
    name: "provider_event_key",
    type: "varchar",
    length: 250,
    unique: true,
  })
  providerEventKey!: string;

  @Column({
    name: "from_status",
    type: "enum",
    enum: ShipmentStatus,
    nullable: true,
  })
  fromStatus!: ShipmentStatus | null;

  @Column({ name: "to_status", type: "enum", enum: ShipmentStatus })
  toStatus!: ShipmentStatus;

  @Column({ type: "varchar", length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: "numeric", precision: 10, scale: 7, nullable: true })
  latitude!: string | null;

  @Column({ type: "numeric", precision: 10, scale: 7, nullable: true })
  longitude!: string | null;

  @Column({
    name: "location_label",
    type: "varchar",
    length: 180,
    nullable: true,
  })
  locationLabel!: string | null;

  @Column({ name: "occurred_at", type: "timestamptz" })
  occurredAt!: Date;

  @Column({ name: "provider_status_code", type: "int", nullable: true })
  providerStatusCode!: number | null;

  @Column({
    name: "event_source",
    type: "varchar",
    length: 16,
    default: "SYSTEM",
  })
  eventSource!: "WEBHOOK" | "POLL" | "SYSTEM";

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
