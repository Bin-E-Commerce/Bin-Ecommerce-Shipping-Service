// Map trạng thái text của GHN sang canonical status của Shipping Service.

import { ShipmentStatus } from "../../../../database/enums/shipment-status.enum";

export interface NormalizedGhnStatus {
  canonicalStatus: ShipmentStatus | null;
  reason: string | null;
}

const STATUS_MAP: Record<string, ShipmentStatus> = {
  ready_to_pick: ShipmentStatus.READY_TO_SHIP,
  picking: ShipmentStatus.PICKUP_ASSIGNED,
  money_collect_picking: ShipmentStatus.PICKUP_ASSIGNED,
  picked: ShipmentStatus.PICKED_UP,
  storing: ShipmentStatus.IN_TRANSIT,
  transporting: ShipmentStatus.IN_TRANSIT,
  sorting: ShipmentStatus.IN_TRANSIT,
  delivering: ShipmentStatus.IN_TRANSIT,
  money_collect_delivering: ShipmentStatus.IN_TRANSIT,
  delivered: ShipmentStatus.DELIVERED,
  delivery_fail: ShipmentStatus.FAILED,
  waiting_to_return: ShipmentStatus.RETURNING,
  return: ShipmentStatus.RETURNING,
  return_transporting: ShipmentStatus.RETURNING,
  return_sorting: ShipmentStatus.RETURNING,
  returning: ShipmentStatus.RETURNING,
  returned: ShipmentStatus.RETURNED,
  return_fail: ShipmentStatus.FAILED,
  cancel: ShipmentStatus.CANCELLED,
  damage: ShipmentStatus.FAILED,
  lost: ShipmentStatus.FAILED,
  exception: ShipmentStatus.FAILED,
};

// GHN dùng trạng thái text; unknown status chỉ lưu metadata và giữ canonical hiện tại.
export function normalizeGhnStatus(
  status: string,
  reason: string | null,
): NormalizedGhnStatus {
  return {
    canonicalStatus: STATUS_MAP[status.trim().toLowerCase()] ?? null,
    reason: reason ?? status,
  };
}
