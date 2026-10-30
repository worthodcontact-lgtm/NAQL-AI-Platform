/**
 * Explicit shipment status and event state machines.
 *
 * The same tables are used by the manual status endpoint and by milestone
 * events, so a booking confirmation or a departure cannot bypass the allowed
 * transitions. Terminal states are terminal.
 */

export const SHIPMENT_STATUSES = [
  "DRAFT",
  "QUOTATION_REQUESTED",
  "QUOTED",
  "BOOKED",
  "IN_TRANSIT",
  "ARRIVED",
  "CUSTOMS_CLEARANCE",
  "DELIVERED",
  "CANCELLED",
  "EXCEPTION"
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  DRAFT: ["QUOTATION_REQUESTED", "CANCELLED"],
  QUOTATION_REQUESTED: ["QUOTED", "CANCELLED"],
  QUOTED: ["BOOKED", "CANCELLED"],
  BOOKED: ["IN_TRANSIT", "CANCELLED", "EXCEPTION"],
  IN_TRANSIT: ["ARRIVED", "EXCEPTION", "CANCELLED"],
  ARRIVED: ["CUSTOMS_CLEARANCE", "EXCEPTION", "CANCELLED"],
  CUSTOMS_CLEARANCE: ["DELIVERED", "EXCEPTION", "CANCELLED"],
  EXCEPTION: ["IN_TRANSIT", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: []
};

export type ShipmentEventCode =
  | "BOOKING_CONFIRMED"
  | "CARGO_RECEIVED"
  | "DEPARTED"
  | "IN_TRANSIT"
  | "ARRIVED"
  | "CUSTOMS_PROCESSING"
  | "CARGO_RELEASED"
  | "DELIVERED"
  | "DELAYED"
  | "CANCELLED";

export interface ShipmentEventDefinition {
  label: string;
  nextStatus: ShipmentStatus | null;
  allowedFrom: ShipmentStatus[];
}

export const SHIPMENT_EVENT_DEFINITIONS: Record<ShipmentEventCode, ShipmentEventDefinition> = {
  BOOKING_CONFIRMED: {
    label: "Booking confirmed",
    nextStatus: "BOOKED",
    allowedFrom: ["DRAFT", "QUOTATION_REQUESTED", "QUOTED", "BOOKED"]
  },
  CARGO_RECEIVED: {
    label: "Cargo received",
    nextStatus: null,
    allowedFrom: ["BOOKED", "IN_TRANSIT"]
  },
  DEPARTED: {
    label: "Shipment departed",
    nextStatus: "IN_TRANSIT",
    allowedFrom: ["BOOKED"]
  },
  IN_TRANSIT: {
    label: "In transit",
    nextStatus: "IN_TRANSIT",
    allowedFrom: ["BOOKED", "IN_TRANSIT", "EXCEPTION"]
  },
  ARRIVED: {
    label: "Arrived at destination",
    nextStatus: "ARRIVED",
    allowedFrom: ["IN_TRANSIT", "EXCEPTION"]
  },
  CUSTOMS_PROCESSING: {
    label: "Customs processing reported",
    nextStatus: "CUSTOMS_CLEARANCE",
    allowedFrom: ["ARRIVED", "CUSTOMS_CLEARANCE"]
  },
  CARGO_RELEASED: {
    label: "Cargo released",
    nextStatus: "CUSTOMS_CLEARANCE",
    allowedFrom: ["CUSTOMS_CLEARANCE"]
  },
  DELIVERED: {
    label: "Delivery completed",
    nextStatus: "DELIVERED",
    allowedFrom: ["ARRIVED", "CUSTOMS_CLEARANCE", "DELIVERED"]
  },
  DELAYED: {
    label: "Shipment delayed",
    nextStatus: "EXCEPTION",
    allowedFrom: ["BOOKED", "IN_TRANSIT", "ARRIVED", "CUSTOMS_CLEARANCE", "EXCEPTION"]
  },
  CANCELLED: {
    label: "Shipment cancelled",
    nextStatus: "CANCELLED",
    allowedFrom: ["DRAFT", "QUOTATION_REQUESTED", "QUOTED", "BOOKED", "IN_TRANSIT", "ARRIVED", "CUSTOMS_CLEARANCE", "EXCEPTION"]
  }
};

export function isShipmentStatus(value: string): value is ShipmentStatus {
  return (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: ShipmentStatus): boolean {
  return isShipmentStatus(from) && SHIPMENT_TRANSITIONS[from].includes(to);
}

export function validateEventTransition(
  code: ShipmentEventCode,
  currentStatus: string
): { ok: true; nextStatus: ShipmentStatus | null } | { ok: false; reason: string } {
  const definition = SHIPMENT_EVENT_DEFINITIONS[code];
  if (!definition) return { ok: false, reason: "unknown_event_code" };
  if (!isShipmentStatus(currentStatus)) {
    return { ok: false, reason: "unknown_current_status" };
  }
  if (!definition.allowedFrom.includes(currentStatus)) {
    return {
      ok: false,
      reason: `Event ${code} is not allowed from shipment status ${currentStatus}.`
    };
  }
  return { ok: true, nextStatus: definition.nextStatus };
}
