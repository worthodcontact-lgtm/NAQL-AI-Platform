-- Additive Phase 5 account classification.
--
-- Existing organizations keep their data. Organizations that already own a
-- logistics provider company are backfilled as providers; all other existing
-- organizations remain customers until they explicitly create a provider
-- profile. No roles, memberships, sessions or verification states change.

ALTER TABLE "Organization"
  ADD COLUMN "accountType" TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN "tradeRole" TEXT;

UPDATE "Organization" AS o
SET "accountType" = 'provider'
WHERE EXISTS (
  SELECT 1
  FROM "Company" AS c
  WHERE c."organizationId" = o."id"
    AND c."type" <> 'importer_exporter'
);

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_accountType_check"
  CHECK ("accountType" IN ('customer', 'provider'));

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_tradeRole_check"
  CHECK ("tradeRole" IS NULL OR "tradeRole" IN ('importer', 'exporter', 'both'));

CREATE INDEX "Organization_accountType_idx" ON "Organization"("accountType");
