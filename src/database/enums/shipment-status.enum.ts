// Định nghĩa trạng thái canonical của shipment, độc lập với mã trạng thái GHN.

export enum ShipmentStatus {
  READY_TO_SHIP = "READY_TO_SHIP",
  PICKUP_ASSIGNED = "PICKUP_ASSIGNED",
  PICKED_UP = "PICKED_UP",
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  RETURNING = "RETURNING",
  RETURNED = "RETURNED",
}
