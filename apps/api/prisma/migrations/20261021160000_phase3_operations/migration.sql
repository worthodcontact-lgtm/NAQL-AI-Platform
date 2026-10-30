-- AlterTable
ALTER TABLE "BookingRequest" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "shipmentId" TEXT;

-- AlterTable
ALTER TABLE "CompanyDocument" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "malwareScanDetail" JSONB,
ADD COLUMN     "malwareScanStatus" TEXT NOT NULL DEFAULT 'not_scanned',
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "retentionUntil" TIMESTAMP(3),
ADD COLUMN     "size" INTEGER,
ADD COLUMN     "uploadedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "malwareScanDetail" JSONB,
ADD COLUMN     "malwareScanStatus" TEXT NOT NULL DEFAULT 'not_scanned',
ADD COLUMN     "retentionUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentExtraction" ADD COLUMN     "processingRunId" TEXT,
ADD COLUMN     "processingStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuotationOffer" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'submitted',
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuotationRequest" ADD COLUMN     "awardedAt" TIMESTAMP(3),
ADD COLUMN     "awardedByUserId" TEXT,
ADD COLUMN     "awardedOfferId" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrackingEvent" ADD COLUMN     "actorOrganizationId" TEXT,
ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "actorUserId" TEXT,
    "actorOrganizationId" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'persisted',
    "externalDeliveryStatus" TEXT NOT NULL DEFAULT 'provider_unavailable',
    "externalDeliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_occurredAt_idx" ON "ShipmentEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "ShipmentEvent_organizationId_recordedAt_idx" ON "ShipmentEvent"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "ShipmentEvent_code_idx" ON "ShipmentEvent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentEvent_shipmentId_idempotencyKey_key" ON "ShipmentEvent"("shipmentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "BookingRequest_shipmentId_idx" ON "BookingRequest"("shipmentId");

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_status_idx" ON "CompanyDocument"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanyDocument_organizationId_idx" ON "CompanyDocument"("organizationId");

-- CreateIndex
CREATE INDEX "CompanyDocument_deletedAt_retentionUntil_idx" ON "CompanyDocument"("deletedAt", "retentionUntil");

-- CreateIndex
CREATE INDEX "Document_deletedAt_retentionUntil_idx" ON "Document"("deletedAt", "retentionUntil");

-- CreateIndex
CREATE INDEX "DocumentExtraction_processingStartedAt_idx" ON "DocumentExtraction"("processingStartedAt");

-- CreateIndex
CREATE INDEX "QuotationOffer_quotationRequestId_status_idx" ON "QuotationOffer"("quotationRequestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationRequest_awardedOfferId_key" ON "QuotationRequest"("awardedOfferId");

-- CreateIndex
CREATE INDEX "Quote_rfqId_status_idx" ON "Quote"("rfqId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_rfqId_companyId_key" ON "Quote"("rfqId", "companyId");

-- CreateIndex
CREATE INDEX "TrackingEvent_bookingRequestId_occurredAt_idx" ON "TrackingEvent"("bookingRequestId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_bookingRequestId_idempotencyKey_key" ON "TrackingEvent"("bookingRequestId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique indexes enforce the business invariants even if two API
-- processes race past the application check.
CREATE UNIQUE INDEX "QuotationOffer_one_awarded_per_request" ON "QuotationOffer"("quotationRequestId") WHERE "status" = 'awarded';
CREATE UNIQUE INDEX "Quote_one_accepted_per_rfq" ON "Quote"("rfqId") WHERE "status" = 'accepted';
