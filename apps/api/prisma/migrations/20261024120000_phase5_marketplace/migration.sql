-- Phase 5 marketplace: additive directory provenance, richer RFQ/quote
-- commercial context, explicit marketplace discovery, and RFQ documents.
-- Every new column has a safe default or is nullable; existing rows remain valid.

ALTER TABLE "Company"
  ADD COLUMN "nameAr" TEXT,
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "recordOrigin" TEXT NOT NULL DEFAULT 'user_registered',
  ADD COLUMN "dataSource" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "publicContactConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pricingIntegrationStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "availabilityIntegrationStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED';

CREATE INDEX "Company_recordOrigin_idx" ON "Company"("recordOrigin");

ALTER TABLE "CompanyService"
  ADD COLUMN "serviceType" TEXT,
  ADD COLUMN "shipmentTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "CompanyService_mode_serviceType_idx" ON "CompanyService"("mode", "serviceType");

ALTER TABLE "Rfq"
  ADD COLUMN "volumeCbm" DECIMAL(65,30),
  ADD COLUMN "packageCount" INTEGER,
  ADD COLUMN "containerCount" INTEGER,
  ADD COLUMN "containerType" TEXT,
  ADD COLUMN "requiredService" TEXT,
  ADD COLUMN "preferredPickupDate" TIMESTAMP(3),
  ADD COLUMN "preferredDeliveryDate" TIMESTAMP(3),
  ADD COLUMN "latestDeliveryDate" TIMESTAMP(3),
  ADD COLUMN "cargoValue" DECIMAL(65,30),
  ADD COLUMN "cargoCurrency" TEXT,
  ADD COLUMN "isHazardous" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "specialRequirements" TEXT,
  ADD COLUMN "discoveryMode" TEXT NOT NULL DEFAULT 'invited',
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

CREATE INDEX "Rfq_status_discoveryMode_idx" ON "Rfq"("status", "discoveryMode");

ALTER TABLE "Quote"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "terms" TEXT,
  ADD COLUMN "serviceDetails" TEXT,
  ADD COLUMN "routeDetails" TEXT,
  ADD COLUMN "pricingSource" TEXT NOT NULL DEFAULT 'provider_submitted',
  ADD COLUMN "priceConfidence" TEXT NOT NULL DEFAULT 'indicative',
  ADD COLUMN "unknownCharges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "excludedServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesQuoteId" TEXT,
  ADD COLUMN "submittedByUserId" TEXT;

CREATE UNIQUE INDEX "Quote_supersedesQuoteId_key" ON "Quote"("supersedesQuoteId");

ALTER TABLE "QuoteItem"
  ADD COLUMN "optional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "chargeType" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "pricingSource" TEXT NOT NULL DEFAULT 'provider_submitted',
  ADD COLUMN "priceConfidence" TEXT NOT NULL DEFAULT 'indicative',
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "notes" TEXT;

CREATE TABLE "RfqDocument" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "size" INTEGER,
    "contentHash" TEXT,
    "malwareScanStatus" TEXT NOT NULL DEFAULT 'not_scanned',
    "malwareScanDetail" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'providers',
    "uploadedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfqDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RfqDocument_rfqId_visibility_idx" ON "RfqDocument"("rfqId", "visibility");
CREATE INDEX "RfqDocument_organizationId_uploadedAt_idx" ON "RfqDocument"("organizationId", "uploadedAt");

ALTER TABLE "RfqDocument"
  ADD CONSTRAINT "RfqDocument_rfqId_fkey"
    FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RfqDocument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
