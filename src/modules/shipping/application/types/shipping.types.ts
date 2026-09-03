// Contract nội bộ của luồng giao nhận, dùng chung cho Order, Seller và provider GHN Test.

import { ShipmentStatus } from "../../../../database/enums/shipment-status.enum";

export const SHIPPING_PROVIDER = "SHIPPING_PROVIDER";
export const GHN_PROVIDER = "GHN_TEST" as const;

export interface GhnAddressSelection {
  provinceId: number;
  districtId: number;
  wardCode: string;
  districtName: string;
  wardName: string;
}

export interface GhnWardOption {
  code: string;
  name: string;
  districtId: number;
}

export interface GhnProvinceOption {
  id: number;
  name: string;
}

export interface GhnDistrictOption {
  id: number;
  name: string;
  provinceId: number;
}

export interface ShippingAddress {
  contactName: string;
  phone: string;
  addressLine: string;
  province: string;
  district: string;
  ward: string;
  street?: string;
  hamlet?: string;
  ghnAddress?: GhnAddressSelection;
}

export interface PickupAddressContext extends ShippingAddress {
  id: string;
}

export interface ShippingOrderContext {
  orderId: string;
  orderNumber: string;
  ownerId: string;
  orderStatus: string;
  shopId: string;
  shippingAddress: ShippingAddress;
  items: Array<{
    productId: string;
    sku: string;
    productName: string;
    imageUrl: string | null;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
    packageWeightGrams: number;
    packageLengthCm: number;
    packageWidthCm: number;
    packageHeightCm: number;
  }>;
}

export interface ReturnShippingOrderContext {
  returnId: string;
  orderId: string;
  orderNumber: string;
  ownerId: string;
  shopId: string;
  shippingAddress: ShippingAddress;
  items: ShippingOrderContext["items"];
}

export interface CurrentSellerContext {
  userId: string;
  email: string;
  permissions: string[];
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  label: string;
}

export interface ShippingQuoteInput {
  shopId: string;
  from: ShippingAddress;
  to: ShippingAddress;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  value: number;
  codAmount: number;
}

export interface ShippingSurcharge {
  type: string;
  title: string;
  amount: string;
}

export interface ShippingQuote {
  provider: typeof GHN_PROVIDER;
  shopId: string;
  serviceCode: string;
  serviceName: string;
  fee: string;
  baseFee: string;
  declaredValueFee: string;
  surcharges: ShippingSurcharge[];
  deliverySupported: boolean;
  estimatedDeliveryAt: Date | null;
}

export interface CreateShipmentInput {
  orderId: string;
  orderNumber: string;
  shopId: string;
  pickupAddress: ShippingAddress;
  shippingAddress: ShippingAddress;
  items: ShippingOrderContext["items"];
  value: number;
  codAmount: number;
  shipmentKind?: "FORWARD" | "RETURN";
}

export interface CreatedShipment {
  providerOrderReference: string;
  trackingId: string;
  providerStatusCode: number | null;
  providerStatusText: string | null;
  status: ShipmentStatus;
  currentLocation: RoutePoint;
  routePoints: RoutePoint[];
  estimatedDeliveryAt: Date | null;
  shippingFee?: string;
}

export interface ProviderShipmentStatus {
  trackingId: string;
  providerOrderReference: string | null;
  providerStatusCode: number | null;
  providerStatusText: string | null;
  status: ShipmentStatus | null;
  currentLocation: RoutePoint | null;
  routePoints?: RoutePoint[];
  estimatedDeliveryAt: Date | null;
  occurredAt: Date;
  reason: string | null;
}

export interface PrintedShippingLabel {
  content: Buffer;
  contentType: "application/pdf" | "text/html";
  fileExtension: "pdf" | "html";
}

export interface ShippingProvider {
  calculateFee(input: ShippingQuoteInput): Promise<ShippingQuote>;
  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
  getShipment(trackingId: string): Promise<ProviderShipmentStatus>;
  cancelShipment(trackingId: string): Promise<void>;
  printLabel(trackingId: string): Promise<PrintedShippingLabel>;
}
