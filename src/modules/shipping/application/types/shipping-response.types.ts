// Public response của shipment, không trả credential hoặc dữ liệu cross-shop không cần thiết.

import { ShipmentStatus } from "../../../../database/enums/shipment-status.enum";

export interface ShipmentResponse {
  id: string;
  orderId: string;
  shipmentKind: "FORWARD" | "RETURN";
  returnRequestId: string | null;
  provider: "GHN_TEST";
  trackingCode: string;
  providerStatusCode: number | null;
  providerStatusText: string | null;
  status: ShipmentStatus;
  statusLabel: string;
  currentLocation: { latitude: number; longitude: number; label: string };
  routePoints: Array<{ latitude: number; longitude: number; label: string }>;
  mapMode: "INTERNAL_PRESENTATION";
  trackingSource: "GHN_TEST";
  demoMode: boolean;
  estimatedDeliveryAt: string | null;
  history: Array<{
    id: string;
    fromStatus: ShipmentStatus | null;
    toStatus: ShipmentStatus;
    reason: string | null;
    locationLabel: string | null;
    occurredAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTrackingResponse {
  orderId: string;
  shipments: ShipmentResponse[];
}
