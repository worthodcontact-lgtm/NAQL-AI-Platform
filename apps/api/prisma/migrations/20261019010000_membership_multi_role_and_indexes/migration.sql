-- Allow a user to hold several roles in the same organization.
-- A membership row is now unique per (organization, user, role) instead of per
-- (organization, user), so combinations such as REVIEWER + DATA_OPERATOR are possible.
DROP INDEX "Membership_organizationId_userId_key";

CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

CREATE UNIQUE INDEX "Membership_organizationId_userId_role_key" ON "Membership"("organizationId", "userId", "role");
