export type Locale = "ar" | "en";

export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN",
  ORG_ADMIN = "ORG_ADMIN",
  OPERATIONS = "OPERATIONS",
  CUSTOMS = "CUSTOMS",
  FINANCE = "FINANCE",
  VIEWER = "VIEWER"
}

export enum ShipmentStatus {
  DRAFT = "DRAFT",
  QUOTATION_REQUESTED = "QUOTATION_REQUESTED",
  QUOTED = "QUOTED",
  BOOKED = "BOOKED",
  IN_TRANSIT = "IN_TRANSIT",
  ARRIVED = "ARRIVED",
  CUSTOMS_CLEARANCE = "CUSTOMS_CLEARANCE",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
  EXCEPTION = "EXCEPTION"
}

export enum TransportMode {
  SEA = "SEA",
  AIR = "AIR",
  LAND = "LAND",
  RAIL = "RAIL",
  MULTIMODAL = "MULTIMODAL"
}

export enum Incoterm {
  EXW = "EXW",
  FCA = "FCA",
  FOB = "FOB",
  CFR = "CFR",
  CIF = "CIF",
  DAP = "DAP",
  DDP = "DDP"
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  organizationId?: string;
  roles: Role[];
  createdAt: string;
}

export interface ShipmentMilestone {
  id: string;
  shipmentId: string;
  code: string;
  label: string;
  occurredAt?: string;
  status: "pending" | "done" | "skipped";
}

export interface Shipment {
  id: string;
  reference: string;
  organizationId: string;
  createdByUserId: string;
  originPortId: string;
  destinationPortId: string;
  mode: TransportMode;
  incoterm: Incoterm;
  status: ShipmentStatus;
  cargoDescription: string;
  weightKg: number;
  volumeCbm?: number;
  milestones: ShipmentMilestone[];
  createdAt: string;
  updatedAt: string;
}

export interface QuotationRequest {
  id: string;
  shipmentId: string;
  organizationId: string;
  status: "open" | "closed" | "awarded";
  requestedAt: string;
}

export interface QuotationOffer {
  id: string;
  quotationRequestId: string;
  providerId: string;
  currency: string;
  amount: number;
  transitDays: number;
  validityUntil: string;
}

export interface LandedCostBreakdown {
  currency: string;
  productCost: number;
  freight: number;
  insurance: number;
  customsDuty: number;
  taxes: number;
  fees: number;
  total: number;
}
