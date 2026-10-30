-- Allow one auditable active quote per provider/RFQ while preserving revisions.
DROP INDEX IF EXISTS "Quote_rfqId_companyId_key";
CREATE UNIQUE INDEX "Quote_one_submitted_per_provider_rfq"
  ON "Quote"("rfqId", "companyId")
  WHERE "status" = 'submitted';

-- RFQs created with validated ports can produce a linked shipment atomically
-- when a quotation is accepted. Nullable fields preserve legacy RFQs.
ALTER TABLE "Rfq"
  ADD COLUMN "originPortId" TEXT,
  ADD COLUMN "destinationPortId" TEXT,
  ADD COLUMN "incoterm" TEXT,
  ADD COLUMN "shipmentId" TEXT;

CREATE UNIQUE INDEX "Rfq_shipmentId_key" ON "Rfq"("shipmentId");
CREATE INDEX "Rfq_originPortId_idx" ON "Rfq"("originPortId");
CREATE INDEX "Rfq_destinationPortId_idx" ON "Rfq"("destinationPortId");

ALTER TABLE "Rfq"
  ADD CONSTRAINT "Rfq_originPortId_fkey"
    FOREIGN KEY ("originPortId") REFERENCES "Port"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_destinationPortId_fkey"
    FOREIGN KEY ("destinationPortId") REFERENCES "Port"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
