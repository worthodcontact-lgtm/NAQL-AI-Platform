import { describe, expect, it } from "vitest";
import {
  requiredDatabaseTables,
  requiredModelDelegates,
  TABLES,
  validateTableCoverage
} from "../../scripts/db-tables.js";

describe("backup table coverage", () => {
  it("includes every model in the Prisma schema", () => {
    expect(() => validateTableCoverage()).not.toThrow();
    expect(new Set(TABLES)).toEqual(new Set(requiredModelDelegates()));
  });

  it("includes the access-separation tables", () => {
    expect(TABLES).toContain("companyInvitation");
    expect(TABLES).toContain("shipmentParty");
    expect(requiredDatabaseTables()).toContain("CompanyInvitation");
    expect(requiredDatabaseTables()).toContain("ShipmentParty");
  });

  it("orders parents before children for insert and reverse order for delete", () => {
    const position = (table: string) => TABLES.indexOf(table as any);
    expect(position("organization")).toBeLessThan(position("membership"));
    expect(position("user")).toBeLessThan(position("companyInvitation"));
    expect(position("company")).toBeLessThan(position("companyDocument"));
    expect(position("shipment")).toBeLessThan(position("shipmentMilestone"));
    expect(position("shipment")).toBeLessThan(position("shipmentParty"));
    expect(position("company")).toBeLessThan(position("shipmentParty"));
    expect(position("quotationRequest")).toBeLessThan(position("quotationOffer"));
    expect(position("rfq")).toBeLessThan(position("quote"));
    expect(position("quote")).toBeLessThan(position("quoteItem"));
    expect(position("quote")).toBeLessThan(position("bookingRequest"));
    expect(position("bookingRequest")).toBeLessThan(position("trackingEvent"));
  });
});
