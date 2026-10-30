# NAQL AI — Implementation Status

## Phase 5 — Logistics Marketplace Extension (2026-10-25)

**Overall status: `PARTIALLY_IMPLEMENTED`.** The core directory, customer/provider account separation, RFQ marketplace, quote provenance/comparison, acceptance, booking/shipment linkage, document visibility and notifications are implemented and tested against an isolated PostgreSQL database. Live carrier pricing/availability/booking, dedicated carrier portals, real external delivery and production readiness are not implemented or remain blocked.

| Capability | Classification |
|---|---|
| Directory categories, 11 seeded international shipping-line candidates, provenance, consent-based contact, filters, profiles, pagination/states | `IMPLEMENTED_AND_TESTED` |
| Directory registration entry point | `IMPLEMENTED_AND_TESTED`; listing grants no account or verification |
| Customer vs provider registration, shared login, importer/exporter/both intent | `IMPLEMENTED_AND_TESTED` |
| Provider-only organization boundary for inbox/opportunities/join/quote routes | `IMPLEMENTED_AND_TESTED` |
| Explicit provider-profile transition; registration and verification separated | `IMPLEMENTED_AND_TESTED` |
| Backfill classification for pre-existing provider organizations | `IMPLEMENTED_BUT_NOT_FULLY_VERIFIED`; migration applied to fresh isolated schema, legacy-token compatibility tested, no production-like data drill |
| RFQ draft/save/submit/cancel, richer cargo/commercial fields, activity history | `IMPLEMENTED_AND_TESTED` |
| Invited RFQs plus explicit `marketplace` discovery and join | `IMPLEMENTED_AND_TESTED` |
| Quote revisions, per-component provenance/confidence, unknown and excluded charges | `IMPLEMENTED_AND_TESTED` |
| Currency-separated comparison and service-difference presentation | `IMPLEMENTED_AND_TESTED` |
| Atomic single-winner acceptance, retry-safe booking, one linked shipment | `IMPLEMENTED_AND_TESTED`; existing Phase 3/4 invariants retained |
| RFQ document upload/visibility/download controls | `IMPLEMENTED_AND_TESTED` |
| In-app notifications for submission/cancellation/join | `IMPLEMENTED_AND_TESTED` |
| Live carrier rates, capacity, availability and external booking | `NOT_IMPLEMENTED` |
| Resend email | `UNVERIFIED`; optional adapter, no real delivery tested |
| WhatsApp/SMS/push | `NOT_IMPLEMENTED` |
| Real ClamAV/OCR/AI, production object storage | `BLOCKED` or `NOT_CONFIGURED` as documented in Phase 2–4 |
| Production migration, staging review, deployment | `BLOCKED` / not authorized |

- Added additive migration `20261024120000_phase5_marketplace` and regenerated Prisma Client. It was applied only to the disposable isolated test cluster, never to production. The migration adds directory provenance/contact-consent/integration fields, service type and shipment types, richer RFQ commercial/discovery/cancellation fields, quote provenance/revision/unknown-charge fields, item charge metadata, and `RfqDocument`.
- Added additive migration `20261025120000_account_types` for `Organization.accountType` (`customer | provider`) and `Organization.tradeRole` (`importer | exporter | both | null`). Existing organizations remain customers unless they already own a non-`importer_exporter` company, which is backfilled as provider. No memberships, roles, sessions or verification rows are rewritten.
- Registration now persists the explicit customer/provider choice and customer trade intent. Provider registration requires an organization name and routes to provider profile onboarding; unknown or privilege-looking account types are treated as customer and never grant platform/provider authority.
- Provider-only RFQ routes now require a provider-classified organization in addition to the existing role, company ownership and RFQ relationship checks. A `COMPANY_OWNER` in a customer organization receives `provider_account_required`; an employee without `quotes.submit` is denied; another provider organization remains denied; admin-scoped tokens are rejected.
- Creating a logistics `Company` profile is the explicit customer-to-provider transition. The legacy `importer_exporter` company type remains readable but does not grant provider capability. Verification and directory listing remain separate from registration.
- Seeded Maersk, MSC, CMA CGM, Wan Hai Lines, Hapag-Lloyd, COSCO Shipping Lines, Evergreen Marine, ONE, Yang Ming, ZIM and Arkas Line as public directory candidates with official websites. They remain unverified, unregistered, have no Egyptian office/agent or port-coverage claim, no organization, null `lastVerifiedAt`, and `NOT_CONFIGURED` pricing/availability integrations.
- Marketplace previews exclude customer organization/creator/contact, private documents, competing quotes and other providers. Join is limited to an owned eligible company, is explicit, idempotent and audited. No external RFQ distribution is claimed.
- Quote validation rejects mixed currencies, negatives, malformed currencies and unsourced published tariffs; unknown is never treated as zero; optional/excluded charges are not folded into the headline total; estimated pricing cannot be marked confirmed; comparison never converts currencies.
- Final verification: **167/167 API tests in 20 files**, **7/7 Chromium tests**, zero skips, in one exit-0 `pnpm test:isolated` run after applying **10 migrations** to disposable `naql_ai_phase41_test`; `pnpm typecheck` **5/5** runnable projects; `pnpm build` **2/2** tasks with 36 web routes. See `docs/PHASE-5-TESTS.md`.
- The first Phase 5 browser attempt had locator strict-mode collisions and a Next.js dev Fast Refresh page error; locators were scoped and the rerun passed all five. After the account tests were added, an interim browser run passed 6/7 because an e2e edit triggered Fast Refresh during the existing lifecycle navigation; the clean run with no concurrent edits passed 7/7. These failures and their resolutions are recorded rather than hidden.
- No production migration, deployment, commit, push, credential rotation or production data change occurred. All pre-existing uncommitted Phase 1–4 work was preserved. See `docs/PHASE-5-AUDIT.md`, `docs/PHASE-5-IMPLEMENTATION.md`, and `docs/PHASE-5-TESTS.md`.

## Phase 4.2 — Lifecycle, browser and notification closure (2026-10-24)

- Closed the customer/provider/security browser gap: `apps/web/e2e/lifecycle.spec.ts` now drives real UI/API routes for RFQ creation, quote submission, withdrawal and resubmission, provider accept denial, customer acceptance, booking confirmation, linked shipment, notifications, cross-organization denial, and uninvited-provider denial.
- Added the notification external-delivery attempt fields and additive migration `20261024090000_phase4_notification_delivery`; both Phase 4 migrations are applied to the local disposable test and development databases (eight migrations total).
- Added the optional Resend email adapter with timeout, safe normalized errors, notification-ID idempotency, attempt tracking, and mocked tests. Email remains `NOT_CONFIGURED` by default and `UNVERIFIED` when configured but not really delivered. WhatsApp still has no adapter.
- Added `importer_exporter` company type support across API validation, admin filtering and registration UI; navigation is now permission/company-driven.
- RFQ detail now returns `viewerRole`, quote company identity/verification, owner-only booking/shipment links, and provider views without owner bookings. Customer, provider and booking screens display the linked shipment and Arabic quote statuses.
- Added `GET /ready?detailed=1` with sanitized database/AI/PDF-OCR/storage/email states, and a configurable `RATE_LIMIT_MAX` (default 100) that the private isolated Playwright API raises to avoid false rate-limit failures.
- Verification after these changes: **151/151 API tests passed in 18 files** against disposable PostgreSQL; **3/3 Chromium browser tests passed**; the final `pnpm test:isolated` combined run exited 0 after applying all eight migrations to a temporary cluster; `pnpm typecheck` passed **5/5** runnable tasks; `pnpm build` passed **2/2** tasks with 36 web routes. See `docs/PHASE-4-E2E-TESTS.md` and `docs/PHASE-4-IMPLEMENTATION.md`.
- Not claimed: real AI, OCR, ClamAV, production object storage, live carrier/AIS/customs tracking, WhatsApp, real Resend delivery, production backup/restore, or production readiness. No commit, push, deployment, production migration, credential rotation, or production data change was performed.

## Phase 4.1 — Stabilization and verification (2026-10-22)

> Historical. The 146-test/one-browser result was superseded by the Phase 4.2 closure (151 API tests and three browser workflows). The isolated-run cleanup issue described below remains environmental residue, not a production blocker.

- Root `pnpm typecheck` passes all five runnable typecheck projects: API, web, shared-types, UI, and validation. `@naql/config` is intentionally not a TypeScript project; it contains only shared compiler options and has no typecheck script.
- Root `pnpm build` passes both available pnpm build tasks: API (Prisma Client generation and TypeScript compilation) and Web (optimized Next.js build with 36 routes). The shared packages have no build scripts. The Python AI service is outside the pnpm workspace and has no production build target.
- Isolated PostgreSQL API suite: **146/146 passed, zero skipped**, including PostgreSQL persistence and RFQ/quote/booking/shipment lifecycle, concurrency, resubmission, tenant isolation and milestone cases. Test database: `naql_ai_phase41_test`, on a random loopback port in a throwaway cluster, never `.pgdata` or production.
- Corrected Playwright browser E2E: **1 passed in 15.9 seconds**, through customer registration fixture, UI sign-in, RFQ creation/listing and RFQ Details. Provider browser flow through quote/booking/shipment is not covered; corresponding API/database flows are covered by the passing suite.
- The full unfiltered runner's API stage passed; its browser assertion failed before correction and was not rerun unfiltered. The final corrected browser test passed in a focused isolated run alongside 2/2 PostgreSQL persistence tests. See `docs/PHASE-4.1-E2E-TESTS.md` for exact boundaries and the remaining stopped temporary directory.
- No production migration, deployment, commit, or push was performed. Third-party services remain unconfigured or unverified. The later Phase 4.2 closure superseded the earlier split-run state with a single combined `pnpm test:isolated` run that exited 0. One historical temporary cluster directory from 2026-10-22 remains in the OS temp directory; it is not production data. Production readiness remains blocked by the unverified services in `docs/PHASE-4.1-IMPLEMENTATION.md` and `docs/PHASE-4-IMPLEMENTATION.md`.

## Phase 4 — Platform completion (2026-10-22)

The Phase 4 repository work is extensively uncommitted. The audit and implementation report in `docs/PHASE-4-*` supersede older Phase 3 limitation bullets below where they conflict.

- RFQ schema now has optional validated port/Incoterm fields and an optional unique shipment link. Accepted eligible quotes create/reuse a booking transactionally; validated RFQs create one linked shipment and grant the accepted provider shipment-party access. Retries do not duplicate the booking/shipment.
- Quote history supports withdrawn/expired revisions using a partial unique index on active submitted quotes. Database-backed tests cover resubmission, expiry, concurrency, acceptance and idempotent linkage; those cases passed in the final disposable PostgreSQL and browser runs.
- Admin integration status registry and `/admin/integrations` UI added. Health checks only claim availability after a bounded live probe; unconfigured or unverified services are labelled honestly.
- Landed-cost responses now include per-component source, verification flag, timestamp, assumptions and an explicit estimated status. No tariffs, taxes, FX rates or freight prices are retrieved or confirmed.
- Added Phase 4 audit, implementation, API, integration, setup and E2E-status documentation.

### Phase 4 classification

| Capability | Classification |
|---|---|
| Validated RFQ → quote → booking/shipment linkage and idempotent retry | `IMPLEMENTED_AND_TESTED` (PostgreSQL API and browser lifecycle) |
| Quote withdrawal/resubmission, expiry and active-offer/winner uniqueness | `IMPLEMENTED_AND_TESTED` (PostgreSQL API and browser) |
| Organization roles, verification and tenant authorization | `IMPLEMENTED_AND_TESTED` for covered customer/provider/security browser cases; other organization categories remain API/UI-covered but not each browser-driven |
| Integration registry / admin screen | `IMPLEMENTED_BUT_UNVERIFIED` for third-party providers; database and extraction probes are live checks |
| Landed-cost provenance | `IMPLEMENTED_AND_TESTED` as a transparent estimate only |
| Internal tracking and in-app notifications | `IMPLEMENTED_AND_TESTED`; external delivery depends on configuration |
| Resend email delivery | `IMPLEMENTED_BUT_UNVERIFIED` (adapter/mock tests only; no real send) |
| WhatsApp, live carrier/AIS/customs, S3 object storage, real OCR/ClamAV/AI | `NOT_IMPLEMENTED`, `NOT_CONFIGURED`, or `BLOCKED` as applicable; never claimed operational |
| Browser Playwright E2E | `IMPLEMENTED_AND_TESTED` (3/3 Chromium workflows) |
| Staging/production readiness | `BLOCKED` pending real credentials, staging operations/security evidence and a production-like restore drill |

Phase 4.2 verification: **151/151 API tests in 18 files**, **3/3 browser tests**, root typecheck **5/5**, production build **2/2** with 36 web routes, and both Phase 4 migrations applied to disposable local databases. Earlier Phase 4 verification lines below are historical and superseded.

## Completed in this pass
- Audit and documentation: `docs/architecture.md`, `docs/implementation-roadmap.md`, `docs/ui-design-system.md`, `docs/frontend-audit.md`.
- Database schema extended with Company, CompanyService, CompanyDocument, VerificationReview, Rfq, RfqRecipient, Quote, QuoteItem, BookingRequest, TrackingEvent, plus AuditLog metadata.
- API modules added: companies (register/submit/directory/detail/documents/admin verify), RFQ/quote/booking workflow, admin overview/companies/audit.
- Audit logging for company registration, submission, verification, quote submission, and booking actions.
- Platform staff authorization separated from company management; non-staff verification returns 403; reviewer-only approval verified by tests.
- Booking requests remain `requested` until a provider confirmation sets `confirmed` with an external reference.
- Frontend pages added: public company directory and detail, RFQ list/detail, company registration, admin console; app shell updated with RFQ, directory, and staff-only admin navigation.
- Tests added for company directory/verification and RFQ/quote/booking workflow.

## Session and identity pass
- Root `AuthProvider` holds session state and syncs across browser tabs (`storage` event + custom auth event).
- `RequireAuth` guard on the `(app)` route group redirects unauthenticated visitors to `/login?next=...` instead of rendering empty pages.
- `apiFetch` handles HTTP 401 centrally: clears the session and redirects to `/login?expired=1`.
- JWT payload decoding fixed for base64url (padding) in `lib/auth.ts`.
- `PublicHeader` on the public site now reflects the session (logged-in badge + "مساحة العمل"), fixing the misleading "تسجيل الدخول" that appeared in every tab.
- Identity is now explicit everywhere: account kind (عميل / شركة / موظف منصة), portal name, roles, display name, email, and organization ID.
- `accountType` selection added to registration. It now persists a customer/provider workspace classification, but still never grants a company or platform role; unknown/privilege-looking values remain customers.
- Mobile navigation added (horizontal link strip) because the sidebar is hidden below `lg`.

## Phase 2 — Intelligence Engine & Document AI (2026-10-21)
- Additive migration `20261021120000_phase2_intelligence` applied to local `naql_ai_phase1_api` and `naql_ai` only; no production migration.
- New tables: `DocumentExtraction`, `DocumentFinding`, `AiExecution`, `CopilotConversation`, `CopilotMessage`, `ShipmentRiskAssessment`, `ShipmentDelayEstimate`.
- Shipment document upload now validates MIME type, extension, size and content signature through a storage abstraction.
- Real document processing endpoint persists extracted fields, provenance, OCR status and an honest `not_scanned` malware status.
- Deterministic consistency engine persists findings with stable codes, severities, observed/expected values, source documents and review flags.
- AI gateway supports no-provider mode, OpenAI/OpenAI-compatible/Ollama adapters, timeout, bounded retries, schema validation, normalized errors and `AiExecution` metadata.
- Copilot derives tenant context only from the authenticated principal, enforces shipment access, cites authorized sources, includes prompt-injection controls and returns an explicitly degraded deterministic summary without a provider.
- Risk and delay are transparent deterministic indicators. Delay days remain `null` when no planned ETA exists; no trained model is claimed.
- Frontend Documents, AI Copilot and shipment detail pages use real APIs with loading, empty, degraded, unavailable and error states.
- Backup table coverage expanded to 31 tables; a local backup/restore drill restored 2,131 rows (including Phase 2 rows) with verified counts into a disposable database.

## Phase 3 — Production Operations (2026-10-21)

- Additive migration `20261021160000_phase3_operations` applied to local `naql_ai` and `naql_ai_phase1_api` only; no production migration.
- Secure document lifecycle: org-authorized upload, server-generated keys, SHA-256, MIME/extension/signature validation, 2 MB decoded limit, storage-failure safety, authenticated bytes download, `shipment`/`private` visibility, quarantine/rejection, audit events, and retention with dry-run default.
- Company verification documents are uploaded through authenticated company routes with real validated bytes. Client-supplied storage keys are rejected.
- Malware adapter supports `not_scanned`, `pending`, `clean`, `infected`, and `scan_failed`; default is `not_scanned`. Optional clamd INSTREAM mode fails closed when configured. Real detection is unverified.
- Document processing is idempotent with a lease/recovery, persisted provenance, warnings, and blocked processing for infected/deleted/metadata-only documents.
- PDF text extraction verified with `pypdf==5.1.0`; optional scanned-PDF/image OCR uses `pypdfium2` + `pytesseract` but native Tesseract is absent, so OCR reports `OCR_UNAVAILABLE`.
- Quote/booking invariants hardened: org ownership, expiry/withdrawal/rejection, currency consistency, computed totals, single acceptance, one winning offer, atomic accept+booking with advisory locks, retry safety, partial unique indexes, and required actor/reason/time decisions.
- Quote withdrawal endpoint added: provider-only, blocked after acceptance, idempotent, audited, persisted notification.
- Booking confirmation/rejection/cancellation require valid authority; rejection/cancellation reasons are mandatory and recorded with actor/time.
- Shipment event state machine added with validated codes/timestamps, per-shipment idempotency, actor/source provenance, transition enforcement, and persisted milestone notifications.
- Imported/external tracking is rejected with `503 live_tracking_integration_unavailable`; `GET /tracking` returns `liveTracking.available=false`. No GPS, vessel, ETA, customs, or carrier data is fabricated.
- Persistent notifications added for quote received/accepted/rejected/withdrawn, booking confirmed/rejected/cancelled, document findings, shipment milestones, and high/critical risk alerts.
- Notifications are user+org scoped, deduplicated, paginated, read/unread, and retry-safe. Phase 4.2 added an optional Resend email adapter with attempt tracking; it remains unverified until a real send. WhatsApp is not implemented; the API/UI state `provider_unavailable` and preserve the in-app record.
- `AI_PROVIDER=none` remains the default. Real provider credentials were not available; deterministic risk/consistency/extraction do not depend on a model.
- Frontend integration: authenticated downloads, document scan/processing states, notifications page + unread badge, shipment milestone timeline/manual form/live-tracking notice, booking reason/retry flows, RFQ quote comparison/acceptance, and provider quote withdrawal.
- Phase 3 docs: `docs/PHASE-3-AUDIT.md`, `docs/PHASE-3-IMPLEMENTATION.md`, `docs/PHASE-3-API.md`, `docs/PHASE-3-SETUP.md`.

### Phase 3 classification

| Capability | Classification |
|---|---|
| Secure shipment/company document upload, list, download, authz | `IMPLEMENTED_AND_TESTED` |
| Strict file validation and server storage keys | `IMPLEMENTED_AND_TESTED` |
| Retention dry-run/apply and soft-delete ordering | `IMPLEMENTED_AND_TESTED` |
| Malware scanning adapter | `IMPLEMENTED_BUT_UNVERIFIED` (no clamd available) |
| PDF text extraction | `IMPLEMENTED_AND_TESTED` |
| Scanned PDF/image OCR | `BLOCKED` (native Tesseract absent) |
| Quote/booking invariants and concurrency | `IMPLEMENTED_AND_TESTED` |
| Booking–shipment linkage | `IMPLEMENTED_AND_TESTED` for validated RFQs (optional for legacy free-text RFQs) |
| Manual shipment timeline and idempotency | `IMPLEMENTED_AND_TESTED` |
| Live/imported tracking | `BLOCKED` (no integration; explicit 503) |
| Persisted in-app notifications | `IMPLEMENTED_AND_TESTED` |
| External email/WhatsApp delivery | Email adapter `IMPLEMENTED_BUT_UNVERIFIED`; WhatsApp `NOT_IMPLEMENTED` |
| Deterministic AI/no-provider mode | `IMPLEMENTED_AND_TESTED` |
| Real AI provider | `BLOCKED` (no credentials/model) |
| Frontend builds and real API usage | `IMPLEMENTED_AND_TESTED` for builds, document/notification paths, and the customer/provider quote-to-booking browser flow |
| Automated browser E2E | `IMPLEMENTED_AND_TESTED` (Phase 4.2: 3/3 Chromium workflows) |
| Production S3/object storage | `BLOCKED` |
| Production migration/deployment | `NOT_PERFORMED` |

## Verification
- API typecheck: pass
- API tests against disposable PostgreSQL: **151/151 passing across 18 files**, zero skipped
- API production build: pass (stop the `tsx watch` process first; Windows Prisma engine replacement fails with `EPERM` while it runs)
- Root typecheck: **5/5 runnable tasks passed**
- Root build: **2/2 tasks passed**; web production build generated **36 routes**
- Prisma validate: pass
- `prisma migrate status`: up to date on both `naql_ai` and `naql_ai_phase1_api`, **8 migrations** (both Phase 4 migrations applied)
- Python service tests: **6 passed**; `pdfText=true`, OCR reported unavailable honestly
- Browser E2E: **3/3 Chromium tests passed** for customer lifecycle, provider lifecycle, and cross-organization/uninvited-provider denial
- Phase 2 details: `docs/PHASE-2-IMPLEMENTATION.md`, `docs/PHASE-2-API.md`, `docs/PHASE-2-SETUP.md`
- Phase 3 details: `docs/PHASE-3-AUDIT.md`, `docs/PHASE-3-IMPLEMENTATION.md`, `docs/PHASE-3-API.md`, `docs/PHASE-3-SETUP.md`

## Build environment note
- `next build` and `next dev` share the `.next` folder. Running a build while the dev server is running corrupts the build and produces
  `PageNotFoundError: Cannot find module for page: /...`. Stop the dev server first, or build with a separate output folder:
  `$env:NEXT_DIST_DIR=".next-verify"; pnpm --filter @naql/web build`
- Added `apps/web/next.config.mjs` with a `distDir` override for exactly this case. Default behaviour is unchanged.

## Remaining limitations
- Phase 3 PDF text extraction is verified with `pypdf`. Scanned-image/PDF OCR is blocked because native Tesseract is not installed; no OCR success is claimed.
- No ClamAV daemon was available. The scanner adapter and fail-closed behavior exist, but real malware detection is unverified.
- No real AI provider was configured or evaluated; no live carrier, port, weather, customs or AIS feed exists.
- Production S3/object storage is not implemented. Local storage outside the web root is the verified mode; production requires `STORAGE_PATH` and a persistent volume.
- Email external delivery is adapter-only and unverified until a real Resend send succeeds. WhatsApp is not implemented. Notifications remain stored in-app regardless of external delivery.
- Quote resubmission after withdrawal/expiry is implemented and tested; history is preserved and only one active submitted quote per provider/RFQ is allowed.
- Booking–shipment linkage is implemented/tested for validated RFQs. Legacy free-text RFQs remain valid without a mandatory shipment.
- Automated customer/provider/security browser E2E is implemented and passing. Production monitoring, production-like backup/restore, and disaster recovery remain unverified; the local Phase 2 backup/restore drill passed.
- Local PostgreSQL runs on `127.0.0.1:5433`; PostGIS is not confirmed.
- Rate ingestion, spreadsheet import, customs portal, carrier/warehouse modules, and HS suggestions are not implemented.
- shadcn/ui and Motion are documented as the target design stack; current implementation uses a compatible custom component layer.
- Core Web Vitals and accessibility audits not yet measured.
- Phase 3 changes are uncommitted. No commit, push, deployment, production migration, or credential rotation was performed.

## Next implementation task
Verify the external dependencies in an approved staging environment: install and run ClamAV, install native Tesseract and validate OCR quality/resource use, configure a real AI provider with documented cost limits, add S3-compatible storage, configure and verify a real email sender, and implement a real carrier/AIS/customs integration before enabling live tracking or imported events. Then run an approved production-like backup/restore drill and staging security review. The customer/provider quote-to-booking browser flow and cross-organization checks are already automated.
