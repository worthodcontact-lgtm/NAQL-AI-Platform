# NAQL AI — Feature Status

Legend:
- **Done** — implemented, integrated, authorized, and covered by a passing test.
- **Partial** — implemented but incomplete, unenforced, or missing a required layer.
- **Unverified** — code exists but has never executed against real infrastructure.
- **Missing** — no implementation.
- **Blocked** — requires an external contract, credential, or approval.

Status reflects executed evidence, not intentions. Every "Done" below was verified by a
command whose result is recorded in `docs/verification-log.md`.

## Authentication and identity

| Feature | Status | Evidence / gap |
|---|---|---|
| Register / login / me | Done | `auth/routes.ts`, tested in memory **and** against PostgreSQL |
| Password hashing (bcrypt) | Done | cost 10 |
| Session guard + cross-tab sync | Done | `AuthProvider`, `RequireAuth` |
| Central 401 handling | Done | `lib/api.ts` |
| Roles persisted per organization | Done | `Membership` rows, unique per (org, user, role); verified in database mode |
| Multi-role memberships | Done | `Membership_organizationId_userId_role_key` migration applied |
| Account-type selection | Done (dev only) | now honoured in **both** database and fallback mode; ignored when `NODE_ENV=production` |
| Password reset | Missing | no token model |
| Email verification | Missing | no mail adapter |
| MFA | Missing | — |
| Session/device revocation | Missing | stateless JWTs |
| Permission matrix | Missing | roles are checked ad hoc per route |

## Company directory and verification

| Feature | Status | Evidence / gap |
|---|---|---|
| Company registration / submit | Done | tested in both modes |
| Public directory with verification state | Done | unregistered companies are not shown as verified |
| Reviewer approve / reject / needs_information | Done | reviewer role now works in database mode too |
| Separation of verification from management | Done | non-staff → 403 |
| Company document upload (real file) | Missing | metadata endpoint only |
| Organization member management | Missing | — |

## Logistics core

| Feature | Status | Evidence / gap |
|---|---|---|
| Shipment CRUD + status machine | Done | tenant isolated, tested |
| Ports reference data | Done | 20 ports seeded; `/api/v1/ports` returns 18 for `country=EG` from PostgreSQL |
| Port referenced by code or id | Done | `POST /shipments` resolves `ALY` or a cuid |
| Shipment list/detail includes ports | Done | `originPort`/`destinationPort` code + name |
| Route planning | Missing | — |
| Containers / dimensions model | Missing | not in the schema |
| Tracking events (labelled source) | Done | source recorded per viewer role; verified in database mode |

## RFQ, quotations, bookings

| Feature | Status | Evidence / gap |
|---|---|---|
| RFQ create / list / detail | Done | tested |
| Tenant isolation on RFQs | Done | outsider → 403 |
| Provider inbox (`/rfqs/incoming`) | Done | derived from company ownership; stranger sees nothing |
| Provider quote submission API | Done | excluded items are not counted in the total |
| Provider quote submission **UI** | Done | `/provider/rfqs` and `/provider/rfqs/[id]` |
| Accept quote → booking request | Done | booking stays `requested` |
| Booking confirm / reject authorization | Done | provider-only; 5 negative cases tested |
| Booking list UI with decisions | Done | `/bookings`, viewer role computed server-side |
| Quote comparison interface | Partial | quotes are listed; no normalised side-by-side comparison |
| Rate cards and provenance | Missing | — |
| Legacy `quotations` domain | Done (deprecated) | authorization inversion fixed; provider-owned company required to submit an offer |

## Documents

| Feature | Status | Evidence / gap |
|---|---|---|
| Upload endpoint with type/size validation | Done | 2 MB cap, allow-list |
| Real file persistence | Partial | disk when `STORAGE_PATH` is set, otherwise an in-memory map |
| Authenticated download / signed URLs | Missing | — |
| Upload UI | Missing | `/documents` lists only |
| Document AI extraction | Partial | the file is still never transmitted to the AI service |
| Cross-document consistency checks | Missing | — |

## AI

| Feature | Status | Evidence / gap |
|---|---|---|
| Provider adapter (TS side) | Partial | timeouts + labelled fallback; no provider configured |
| Provider abstraction (Python side) | Missing | environment variables are never read |
| Copilot | Partial | fixed string; no grounding |
| Grounded retrieval from the database | Missing | — |
| Document OCR / extraction | Missing | — |
| HS code suggestions + human review | Missing | — |
| Delay prediction | Partial | constant `0` |
| Landed-cost intelligence | Partial | deterministic service only |
| Usage, budgets, observability | Missing | — |

Nothing in this section may be described as working until a provider is configured.

## Platform

| Feature | Status | Evidence / gap |
|---|---|---|
| Admin overview / companies / audit | Done | staff-only, tested |
| Structured logging + request correlation | Done | pino with `genReqId`; visible in the E2E run |
| Explicit persistence mode | Done | `/health` reports `database` or `memory`; UI banner in fallback mode |
| Production fail-fast without a database | Done | API refuses to start when `NODE_ENV=production` and `DATABASE_URL` is absent |
| Decimal / date normalisation | Done | one `preSerialization` hook; identical shapes in both modes |
| Notifications | Missing | — |
| Analytics | Missing | placeholder page |
| Settings | Missing | placeholder page |
| Customs broker portal | Missing | — |
| Carrier / warehouse workflows | Missing | — |
| CSV import / export | Missing | — |
| i18n (Arabic + English) | Missing | Arabic hardcoded |
| Rate limiting per sensitive route | Partial | global 100/min only |
| CORS allow-list | Partial | `CORS_ORIGINS` supported; empty allow-list in production is not yet enforced as a hard failure |
| CI | Missing | — |
| E2E browser tests | Missing | API-level E2E exists |

## Verified this session

- PostgreSQL 16 running natively, no administrator rights, no Docker.
- Two migrations applied; seed created 20 ports.
- Data survives an API restart (same company id before and after).
- 19/19 automated tests pass with `DATABASE_URL`; 17 pass and 2 skip without it.
- 18/18 API end-to-end checks pass against the real database.
- Production web build succeeds: 22 routes.
