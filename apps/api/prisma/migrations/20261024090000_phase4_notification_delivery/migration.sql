-- Add explicit external-delivery attempt evidence. Existing rows keep their
-- current status and a zero attempt count; no delivery is implied by this
-- additive migration.
ALTER TABLE "Notification"
  ADD COLUMN "externalDeliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "externalDeliveryLastAttemptAt" TIMESTAMP(3);
