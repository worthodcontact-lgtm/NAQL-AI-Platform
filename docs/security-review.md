# NAQL AI — Security Review

Baseline commit `1075408`. Scope: authentication, authorization, tenant isolation,
file handling, AI boundaries, and platform configuration.

## Findings

### S1 — CRITICAL — Booking confirmation had no provider authorization — FIXED

`POST /api/v1/bookings/:id/confirm` required only a valid JWT. Any authenticated user,
including a competing customer, could confirm any booking in any organization.

The handler now derives the confirming authority from the accepted quote:

1. Load the booking and the quote referenced by `booking.quoteId`.
2. Resolve `providerCompanyId` from that quote (never from the request body).
3. Allow only an organization that owns `providerCompanyId`, or platform staff.
4. Require an `externalReference` to confirm; allow `reject` with an optional reason.
5. Reject decisions on bookings that are already `confirmed`, `rejected` or `cancelled`.

Covered by tests: customer self-confirm → 403, unrelated user → 403, missing reference → 400,
provider confirm → 200, double confirm → 409, provider reject → 200.

### S2 — HIGH — Legacy quotation offers were writable by the customer — FIXED

`POST /api/v1/quotations/:id/offers` originally checked
`quote.organizationId === user.organizationId`, i.e. the requesting customer wrote offers
onto their own request. A provider could not respond, and a customer could fabricate
competing offers.

The route now requires the caller's organization to own the `providerId` company:

```ts
if (!(await organizationOwnsCompany(user.organizationId, parsed.data.providerId))) {
  return forbidden(reply);
}
```

Covered by tests: customer self-offer → 403, forged provider id → 403, genuine provider
offer → 200, customer award → 200. This domain is deprecated in favour of `rfq`; it stays
only until existing data is migrated.

### S3 — HIGH — Document AI never receives the file — OPEN

`documents/routes.ts` calls `fetch(AI_SERVICE_URL + "/documents/validate", { method: "POST" })`
with no body and no file, then records the result as a validation outcome.

Planned resolution: stream the stored object through an authenticated multipart request,
and record extraction provenance.

### S4 — MEDIUM — Permissive CORS in development — PARTIAL

Development still reflects any origin for convenience. `CORS_ORIGINS` is now supported and
takes precedence, and production returns an empty allow-list when it is unset. A hard
start-up failure in production is not implemented yet.

### S5 — MEDIUM — Silent in-memory fallback in production — FIXED

`db.ts` now refuses to construct the application when `NODE_ENV=production` and
`DATABASE_URL` is absent:

```ts
if (isProduction && !env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when NODE_ENV=production. ...");
}
```

`/health` reports `persistenceMode: "database" | "memory"` and `/ready` performs a real
`SELECT 1`. The web app shows a warning banner whenever the API reports memory mode.

### S6 — MEDIUM — Rate limiting is global only — OPEN

A single 100 request/minute limit applies to every route equally. Authentication, password
reset, uploads, and AI endpoints need stricter, separate budgets.

### S7 — LOW — Structured logging disabled — FIXED

`Fastify({ logger: { level } })` with a UUID `genReqId`. Requests are logged with an id,
status code, and response time, which is what made the E2E diagnosis possible.

### S8 — LOW — Development role hints are client-driven — MITIGATED

Registration accepts `accountType` and maps it to roles. It is honoured **only** when
`NODE_ENV !== "production"`. In production, roles come from `Membership` records only.

## Verified protections

| Control | Evidence |
|---|---|
| JWT required on protected routes | `app.decorate("authenticate")`, 401 without a token (tested) |
| Tenant isolation on shipments | cross-tenant read → 404 (tested in both modes) |
| Tenant isolation on RFQs | outsider read → 403 (tested in both modes) |
| Tenant isolation on provider inbox | outsider inbox has no matching RFQ (tested) |
| Tenant isolation on bookings | outsider list has no matching booking (tested) |
| Verification authority separate from company management | non-staff verify → 403 (tested) |
| Booking confirmation authority | provider-only, 5 negative cases tested |
| Quote submission authority | company ownership checked server-side (tested) |
| Passwords hashed | bcrypt, cost 10 |
| Upload content-type and size validation | `documents/routes.ts`, 2 MB cap, allow-list |
| No secrets in client bundles | only `NEXT_PUBLIC_*` variables are exposed |
| Production cannot run without a database | verified by construction in `db.ts` |

## Outstanding verification required

- Cross-tenant file download attempts once real uploads exist.
- Token revocation once sessions are persisted.
- Frontend accessibility and dependency audit.
- Production CORS fail-fast.
