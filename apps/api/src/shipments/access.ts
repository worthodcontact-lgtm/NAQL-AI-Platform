import { prisma } from "../db.js";
import { AuthUser } from "../auth/routes.js";

/**
 * Per-shipment collaboration access.
 *
 * Ownership is always derived from the shipment row, never from a client-supplied
 * organization id. A non-owner organization gets access only through a
 * `ShipmentParty` row for a company it owns, and only for the specific action
 * flags granted on that row.
 */
export type ShipmentAction =
  | "view"
  | "updateStatus"
  | "uploadDocument"
  | "viewDocuments"
  | "viewFinancials"
  | "quote"
  | "manageParties"
  | "confirmDelivery";

export interface ShipmentPartyRecord {
  id: string;
  shipmentId: string;
  companyId: string;
  partyRole: string;
  canView: boolean;
  canUpdateStatus: boolean;
  canUploadDocuments: boolean;
  canViewDocuments: boolean;
  canViewFinancials: boolean;
  canQuote: boolean;
  canManageParties: boolean;
  canConfirmDelivery: boolean;
  company: {
    id: string;
    name: string;
    organizationId: string | null;
    type: string;
    verificationStatus: string;
  };
}

export interface ShipmentAccess {
  shipment: any;
  role: "owner" | "party";
  party: ShipmentPartyRecord | null;
  isOwner: boolean;
}

export async function loadShipmentAccess(
  user: AuthUser,
  shipmentId: string
): Promise<ShipmentAccess | null> {
  if (!prisma || !user.organizationId || !shipmentId) return null;

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      originPort: { select: { id: true, code: true, name: true, country: true, type: true } },
      destinationPort: { select: { id: true, code: true, name: true, country: true, type: true } },
      milestones: { orderBy: { occurredAt: "asc" } },
      parties: {
        include: {
          company: {
            select: {
              id: true,
              name: true,
              organizationId: true,
              type: true,
              verificationStatus: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (!shipment) return null;

  if (shipment.organizationId === user.organizationId) {
    return { shipment, role: "owner", party: null, isOwner: true };
  }

  const party = (shipment.parties as ShipmentPartyRecord[]).find(
    (candidate) =>
      candidate.canView && candidate.company.organizationId === user.organizationId
  );
  if (!party) return null;

  return { shipment, role: "party", party, isOwner: false };
}

export function partyAllows(access: ShipmentAccess | null, action: ShipmentAction): boolean {
  if (!access) return false;
  if (access.isOwner) return true;
  const party = access.party;
  if (!party) return false;
  switch (action) {
    case "view":
      return party.canView;
    case "updateStatus":
      return party.canUpdateStatus;
    case "uploadDocument":
      return party.canUploadDocuments;
    case "viewDocuments":
      return party.canViewDocuments;
    case "viewFinancials":
      return party.canViewFinancials;
    case "quote":
      return party.canQuote;
    case "manageParties":
      return party.canManageParties;
    case "confirmDelivery":
      return party.canConfirmDelivery;
    default:
      return false;
  }
}

/** Prisma `where` fragment for every shipment the caller may at least view. */
export function visibleShipmentWhere(user: AuthUser) {
  return {
    OR: [
      { organizationId: user.organizationId },
      {
        parties: {
          some: {
            canView: true,
            company: { organizationId: user.organizationId }
          }
        }
      }
    ]
  };
}
