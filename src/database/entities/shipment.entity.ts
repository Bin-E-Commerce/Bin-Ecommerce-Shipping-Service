// Entity persistence lưu snapshot shipment theo từng cặp order/shop.
// Database layer chỉ sở hữu dữ liệu giao nhận; ownership nghiệp vụ vẫn được xác minh qua Order/Seller Service.

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";
import { ShipmentStatus } from "../enums/shipment-status.enum";
import { ShipmentEvent } from "./shipment-event.entity";

// Map bảng shipments với các cột snapshot và quan hệ append-only shipment events.
@Entity({ name: "shipments" })
@Index("uq_shipments_order_shop", ["orderId", "shopId"], { unique: true })
@Index("uq_shipments_provider_tracking", ["provider", "trackingCode"], {
  unique: true,
})
@Index("idx_shipments_shop_created_at", ["shopId", "createdAt"])
export class Shipment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "order_id", type: "uuid" })
  orderId!: string;

  @Column({ name: "order_number", type: "varchar", length: 64 })
  orderNumber!: string;

  @Column({ name: "shop_id", type: "uuid" })
  shopId!: string;

  @Column({ name: "seller_user_id", type: "uuid" })
  sellerUserId!: string;

  @Column({ name: "customer_user_id", type: "uuid" })
  customerUserId!: string;

  @Column({ type: "varchar", length: 32, default: "GHN_TEST" })
  provider!: string;

  @Column({ name: "provider_order_reference", type: "varchar", length: 250 })
  providerOrderReference!: string;

  @Column({
    name: "provider_tracking_id",
    type: "varchar",
    length: 128,
    unique: true,
  })
  providerTrackingId!: string;

  @Column({ name: "provider_status_code", type: "int", nullable: true })
  providerStatusCode!: number | null;

  @Column({
    name: "provider_status_text",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  providerStatusText!: string | null;

  @Column({
    name: "last_provider_synced_at",
    type: "timestamptz",
    nullable: true,
  })
  lastProviderSyncedAt!: Date | null;

  @Column({ name: "pickup_address_snapshot", type: "jsonb" })
  pickupAddressSnapshot!: Record<string, unknown>;

  @Column({ name: "tracking_code", type: "varchar", length: 128, unique: true })
  trackingCode!: string;

  @Column({
    type: "enum",
    enum: ShipmentStatus,
    enumName: "shipment_status_enum",
  })
  status!: ShipmentStatus;

  @Column({
    name: "current_latitude",
    type: "numeric",
    precision: 10,
    scale: 7,
  })
  currentLatitude!: string;

  @Column({
    name: "current_longitude",
    type: "numeric",
    precision: 10,
    scale: 7,
  })
  currentLongitude!: string;

  @Column({ name: "current_location_label", type: "varchar", length: 180 })
  currentLocationLabel!: string;

  @Column({ name: "route_points", type: "jsonb" })
  routePoints!: Array<{ latitude: number; longitude: number; label: string }>;

  @Column({
    name: "estimated_delivery_at",
    type: "timestamptz",
    nullable: true,
  })
  estimatedDeliveryAt!: Date | null;

  @VersionColumn({ name: "version" })
  version!: number;

  @OneToMany(() => ShipmentEvent, (event) => event.shipment, { cascade: true })
  events!: ShipmentEvent[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
