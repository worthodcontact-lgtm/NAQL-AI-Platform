-- Access-control separation: company memberships, invitations, shipment parties,
-- and document visibility.
--
-- This migration is additive. It does not drop or rewrite existing business data.
-- Existing memberships become `active` and existing documents become `shipment`
-- (shared with the owner and with parties that are explicitly granted document
-- access). Existing legacy roles remain valid and are mapped by the API.

-- DropIndex
DROP INDEX "Membership_userId_idx";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "uploadedByOrganizationId" TEXT,
ADD COLUMN     "uploadedByUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'shipment';

-- AlterTable
-- `updatedAt` needs a database default so existing rows can be backfilled in one
-- statement. Prisma continues to manage the value on every application update.
ALTER TABLE "Membership" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "invitedByUserId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CompanyInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentParty" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partyRole" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canUpdateStatus" BOOLEAN NOT NULL DEFAULT false,
    "canUploadDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canViewDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canViewFinancials" BOOLEAN NOT NULL DEFAULT false,
    "canQuote" BOOLEAN NOT NULL DEFAULT false,
    "canManageParties" BOOLEAN NOT NULL DEFAULT false,
    "canConfirmDelivery" BOOLEAN NOT NULL DEFAULT false,
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvitation_tokenHash_key" ON "CompanyInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanyInvitation_organizationId_email_status_idx" ON "CompanyInvitation"("organizationId", "email", "status");

-- CreateIndex
CREATE INDEX "CompanyInvitation_status_expiresAt_idx" ON "CompanyInvitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ShipmentParty_companyId_idx" ON "ShipmentParty"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentParty_shipmentId_companyId_key" ON "ShipmentParty"("shipmentId", "companyId");

-- CreateIndex
CREATE INDEX "Document_shipmentId_visibility_idx" ON "Document"("shipmentId", "visibility");

-- CreateIndex
CREATE INDEX "Document_uploadedByOrganizationId_idx" ON "Document"("uploadedByOrganizationId");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentParty" ADD CONSTRAINT "ShipmentParty_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentParty" ADD CONSTRAINT "ShipmentParty_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
