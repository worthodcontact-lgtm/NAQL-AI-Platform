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
| Separate platform roles | Done | `User.platformRole`; independent of organization membership |
| Admin login separated from ordinary login | Done | `/api/v1/admin/auth/login`, `scope: "admin"`, dedicated storage key; tested |
| Permission matrix enforced in API | Done | `auth/permissions.ts` + `requirePermission` on every admin route; 28 admin security/integration tests (54 total) |
| Session revocation on suspension/role change/logout | Done | `User.sessionVersion` in token; stale `sv` → `401 session_revoked`; logout revokes server-side |
| Token expiry | Done | admin 8h, app 12h; legacy admin tokens without `exp` rejected |
| Password reset | Partial | platform admins only, via protected CLI (`admin -- reset-password`); no self-service token flow |
| Email verification | Missing | no mail adapter |
| MFA | Missing | — |

## Company directory and verification

| Feature | Status | Evidence / gap |
|---|---|---|
| Company registration / submit | Done | tested in both modes |
| Public directory with verification state | Done | unregistered companies are not shown as verified; unlisted companies are absent from both the directory and direct public profile lookup |
| Reviewer approve / reject / needs_information | Done | `POST /api/v1/admin/companies/:id/verify`; reason required for non-approval; tested |
| Verification decision history | Done | `CompanyReview` rows shown in the admin company file; audited |
| Separation of verification from management | Done | `companies.verify` permission; own-organization conflict blocked; non-staff → 403 |
| Government accreditation claim | Not claimed | UI and docs state that verification is an internal review only |
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

## External trade data (UN Comtrade)

| Feature | Status | Evidence / gap |
|---|---|---|
| Subscription key storage | Done | `COMTRADE_API_KEY` + secondary in the git-ignored root `.env`; never sent to the browser |
| `GET /api/v1/trade/status` | Done | authenticated; reports configuration only, never the key |
| `GET /api/v1/trade/overview` | Done | totals, top partners, top HS chapters, five-year series; 8 automated tests |
| Live provider verification | Done | both keys returned HTTP 200 for Egypt 2023 |
| Response cache | Done | 30 minutes, 64 entries, in-process; verified second request makes no upstream call |
| Key rotation | Done | secondary key tried when the primary is rejected (401/403) |
| Honest failure modes | Done | `503 not_configured`, `503 rate_limited`, `502 upstream_error`, `504 timeout`; no fabricated rows |
| Sequential upstream calls | Done | parallel calls triggered upstream burst rejection; now serialized with a 120 ms gap |
| UI `/trade` | Done | Arabic RTL, provenance badge and fetch timestamp, explicit error card |
| Trade data persisted locally | Missing | fetched live and cached in memory only; lost on restart (re-fetched) |
| Full commodity detail / historical archive | Missing | only top 10 and a five-year window |

## Platform administration

| Feature | Status | Evidence / gap |
|---|---|---|
| Independent admin login | Done | `POST /api/v1/admin/auth/login`; rejects ordinary accounts with `not_platform_staff`; rate-limited |
| Roles and least-privilege matrix | Done | SUPER_ADMIN / ADMIN / REVIEWER / SUPPORT; matrix in `auth/permissions.ts`; documented in `docs/platform-admin.md` |
| Protected first Super Admin provisioning | Done | server-side CLI with `ADMIN_BOOTSTRAP_SECRET`, bcrypt 12, masked password; no public elevation path |
| User search, detail, memberships | Done | `/api/v1/admin/users`; bounded pagination; no password/session fields exposed |
| Suspend / reactivate with reason | Done | audited; increments `sessionVersion`; self-suspend blocked |
| Platform role assignment | Done | Super-Admin-only; self-elevation blocked; last-active-Super-Admin guard |
| Companies directory | Done | searchable and filterable; verification status shown honestly |
| Verification queue and decisions | Done | approve / reject / request information with documented reason; audited |
| Shipments / bookings / RFQs / quotations views | Done | read-only, paginated, no invented prices or coordinates |
| Ports reference editing | Done | only `name`, `type`, `source`; coordinates immutable; audited |
| Dashboard metrics | Done | real `count`/`groupBy` queries; `503` on failure instead of fabricated values |
| Reports | Done | status distributions, top organizations, per-currency quote totals |
| Persistent audit log | Done | append-only through the app; actor, role, action, entity, outcome, request ID, redacted metadata; high-risk mutations commit atomically with their audit row |
| Platform settings | Partial | only `platformName`, `supportEmail`, `maintenanceMessage`; no env/secret editor |
| Admin web console | Done | 20 routes under `/admin`; Arabic RTL, permission-gated navigation, confirmation dialogs |
| Admin MFA / IP allow-list | Missing | — |
| Admin browser E2E suite | Missing | API authorization is covered; UI verified by typecheck, build, and unauthenticated browser smoke checks |
| Admin session storage | Partial | short-lived Bearer token in `localStorage`; server-side revocation works, but HttpOnly cookie + CSRF migration is proposed only (`docs/platform-admin.md` §10.1) |

## Platform

| Feature | Status | Evidence / gap |
|---|---|---|
| Admin console | Done | see **Platform administration** above; 20 web routes |
| Structured logging + request correlation | Done | pino with `genReqId`; request ID recorded in audit entries |
| Explicit persistence mode | Done | `/health` reports `database` or `memory`; UI banner in fallback mode |
| Production fail-fast without a database | Done | API refuses to start when `NODE_ENV=production` and `DATABASE_URL` is absent |
| Decimal / date normalisation | Done | one `preSerialization` hook; identical shapes in both modes |
| Notifications | Missing | — |
| Analytics | Missing | placeholder page |
| Settings | Partial | three whitelisted platform settings with Super-Admin-only writes; external providers shown by configuration presence only |
| Customs broker portal | Missing | — |
| Carrier / warehouse workflows | Missing | — |
| CSV import / export | Missing | — |
| i18n (Arabic + English) | Missing | Arabic hardcoded |
| Rate limiting per sensitive route | Done | admin login, ordinary login, and registration limited to 20/min; global 100/min; 429 exercised by a test; in-process store (Redis/multi-instance is future work) |
| CORS allow-list | Done | `CORS_ORIGINS` supported; production refuses to start with an empty allow-list |
| Production secret hygiene | Done | production refuses to start with the development `JWT_SECRET` or a secret shorter than 32 characters |
| Backup / restore | Missing | no verified automated `pg_dump`/restore mechanism in the repository |
| CI | Missing | — |
| E2E browser tests | Missing | API-level E2E exists |

## Verified this session

- PostgreSQL 16 running natively, no administrator rights, no Docker.
- Three migrations applied additively; the admin migration preserves all existing rows.
- Data survives an API restart (same company id before and after).
- 54/54 automated tests pass against the existing development database **and** against a
  freshly migrated, seeded throwaway database (which was dropped afterwards).
- API typecheck and build pass; web typecheck and production build pass.
- Production web build: 42 routes, including 20 `/admin` routes.
- Admin login, dashboard metrics, suspension, role change, verification, settings, ports, and
  audit generation are covered by API tests; the login page and unauthenticated guard were
  also exercised in a real browser.
- Hardening probes confirmed and fixed: missing token expiry, ineffective logout, ordinary-token
  staff overrides, last-Super-Admin TOCTOU, end-of-day date filtering, unlisted-company lookup,
  swallowed audit failures, production default JWT secret, and internal error leakage.
