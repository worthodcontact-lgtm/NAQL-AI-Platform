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

### S4 — MEDIUM — Permissive CORS in development — FIXED

Development still reflects any origin for convenience. `CORS_ORIGINS` is supported and takes
precedence; production now refuses to start when the allow-list is empty or missing.

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

### S6 — MEDIUM — Rate limiting is global only — PARTIAL

The global budget is 100 requests/minute. Login and registration routes now have explicit
20/minute limits, including the separate admin login; the 429 path is covered by an automated
test. Uploads and AI endpoints still share the global budget, and the store is in-process (see
the Redis/`trustProxy` note in `docs/platform-admin.md` §10).

### S7 — LOW — Structured logging disabled — FIXED

`Fastify({ logger: { level } })` with a UUID `genReqId`. Requests are logged with an id,
status code, and response time, which is what made the E2E diagnosis possible.

### S8 — LOW — Development role hints are client-driven — FIXED

Registration no longer accepts `accountType` or any role hint in either mode. The API ignores
unknown fields and never writes `platformRole`; a regression test submits a forged
`accountType: "ADMIN"` and confirms the resulting account has no platform role.

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
- Frontend accessibility and dependency audit.
- Production CORS fail-fast.

## Admin-phase update (2026-10-19)

The baseline review above predates the platform-administration phase. Two statements are now
outdated:

- **Platform authority no longer comes from `Membership`.** It comes exclusively from
  `User.platformRole`. Organization roles remain organization-scoped and cannot open the admin
  area.
- **Token revocation is implemented for platform accounts.** `User.sessionVersion` is embedded
  as `sv`; suspension, reactivation, role changes, and password resets increment it, and the
  database is consulted on every request.

Additional controls verified by tests:

| Control | Evidence |
|---|---|
| Ordinary token rejected by the admin namespace | `403 admin_session_required`; tested |
| Ordinary account cannot obtain an admin token | `403 not_platform_staff`; tested |
| Company ownership does not grant platform authority | tested |
| Reviewer cannot perform Super-Admin-only operations | `403 insufficient_permission`; tested |
| Support is read-mostly | audit read and settings write denied; tested |
| Self-elevation and self-suspension blocked | tested |
| Last active Super Admin protected | API guard + unit test |
| Suspension revokes an existing token | old token → `403 account_suspended`; tested |
| Role change revokes existing privileges | old token → `401 session_revoked`; tested |
| Audit entries contain no credentials | redaction unit test + live query inspection |
| Migration is additive | migration test asserts no `DROP`/destructive statement |

### Hardening audit (2026-10-19)

Confirmed issues found by probing the running application and fixed in this pass:

| ID | Severity | Issue | Fix / evidence |
|---|---|---|---|
| H1 | HIGH | Admin JWTs had no `exp`; a leaked token was valid until manual revocation | Admin TTL 8h, app TTL 12h; legacy no-exp admin tokens → `401 session_expired`; tested |
| H2 | HIGH | Admin logout only cleared `localStorage`; a copied token still worked | Logout increments `sessionVersion`; old token → `401 session_revoked`; tested |
| H3 | HIGH | Platform business overrides worked with an ordinary app token | `can()`/`isPlatformStaff()` require `scope: "admin"`; ordinary token cross-tenant RFQ read → `403`; tested |
| H4 | HIGH | Production accepted the default `JWT_SECRET` and empty CORS list | Start-up refuses weak/missing secret and empty CORS in production |
| H5 | MEDIUM | Last-Super-Admin guard was count-then-update (TOCTOU) | PostgreSQL advisory lock inside one transaction; API and CLI use the same helper |
| H6 | MEDIUM | `to=YYYY-MM-DD` excluded records after midnight | `to` is end-of-day UTC for audit, users, shipments, bookings, RFQs, quotes; tested |
| H7 | MEDIUM | Unlisted companies were readable by guessing their public ID | Public profile requires `listed: true`; owner uses `/companies/mine`; tested |
| H8 | MEDIUM | High-risk mutation and audit row could diverge; audit failures were swallowed | Transaction-scoped strict audit for role/suspension, verification, settings, ports, CLI |
| H9 | LOW | Default Fastify errors could expose Prisma/SQL text | Generic `500 internal_error` + request ID; server-side log only |
| H10 | LOW | No admin response security headers | `no-store`, `nosniff`, frame/referrer/permissions headers on API and web |
| H11 | LOW | Clearing optional settings failed email validation | Empty `supportEmail`/`maintenanceMessage` deletes the setting; tested |

Residual risks are enumerated in `docs/platform-admin.md` §10: localStorage tokens (cookie/CSRF
migration proposed, not implemented), no MFA, client-side UX guard, all-session logout coupling,
best-effort login/logout audit, per-process rate limiting, and the absence of browser E2E coverage.

