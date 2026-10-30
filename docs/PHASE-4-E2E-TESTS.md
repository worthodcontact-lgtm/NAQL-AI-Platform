# Phase 4 End-to-end test status

## Current status

Browser E2E is **implemented and executed** for three Chromium workflows against real API and web routes. The final local run passed **3/3** tests:

| Spec | Workflow | Result | Duration |
|---|---|---|---|
| `apps/web/e2e/lifecycle.spec.ts` — customer/provider lifecycle | Customer registers and signs in; creates a validated RFQ; provider sees the invitation, submits a quote, withdraws it, resubmits; provider cannot accept its own quote; customer sees both revisions with provider identity; customer accepts once; provider confirms the booking; customer opens the linked shipment; notifications show the received quote and no external channel | **Passed** | 52.1s |
| `apps/web/e2e/lifecycle.spec.ts` — security | A different organization is denied access to the shipment and RFQ by the browser; an uninvited provider cannot open/submit against the RFQ | **Passed** | 23.4s |
| `apps/web/e2e/rfq.spec.ts` | Registered customer signs in and creates an RFQ through the form | **Passed** | 9.2s |

The run used `apps/web/playwright.config.ts`, Chromium at `.playwright-browsers`, API `127.0.0.1:4001`, web `127.0.0.1:3100`, and the local disposable PostgreSQL database. The final `pnpm test:isolated` combined run also completed with exit code 0, applying all eight migrations to a temporary cluster, passing 151/151 API tests, and passing the same 3/3 browser tests. No production user, production database, or external paid service was used.

## Run it

```powershell
pnpm --filter @naql/web exec playwright install chromium
pnpm test:isolated
```

`pnpm test:isolated` provisions a temporary PostgreSQL cluster on a random loopback port, verifies the database target, applies every migration, checks migration status, generates Prisma Client, seeds reference ports, runs the full API suite, starts API and web on separate local ports, runs Playwright, then stops and removes its private cluster. It never uses `.pgdata` or the persistent development database.

The browser suite can also be run separately when API and web are already running at ports 4001/3100:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH="E:\naql ai\.playwright-browsers"
pnpm --filter @naql/web exec playwright test --config playwright.config.ts
```

The isolated runner raises `RATE_LIMIT_MAX` only inside its private API process. Without that, repeated local browser runs can exhaust the production-style 100 requests/minute limit and produce misleading empty states; the normal default remains 100.

## Coverage

| Layer | Flow | Evidence |
|---|---|---|
| PostgreSQL API tests | Registration, companies, RFQ and quotation submission/withdrawal/resubmission, acceptance, booking, linked shipment, permissions, milestones, documents, costs, notifications and persistence | **18 files, 151/151 tests passed, 0 skipped** against the disposable PostgreSQL test database |
| Browser — customer | Register/sign in, create validated RFQ, compare quote revisions, accept once, view booking and linked shipment, view in-app notifications | Chromium Playwright, passed |
| Browser — provider | See only invited RFQ, submit quote, withdraw, resubmit, see quote status, confirm booking | Chromium Playwright, passed |
| Browser — security | Cross-organization shipment/RFQ denial; uninvited-provider denial; no customer-only accept control for provider | Chromium Playwright, passed |
| Registry | Configuration, connectivity, and operation signals are separate; provider status never claims an unperformed operation | Unit tests cover configured/failed and probe-only states |
| Cost assessment | Missing components stay unknown; incomplete input has no total; mixed currencies fail validation | Unit/API regression tests |

## Results

### Final local verification (2026-10-24)

| Command / stage | Result |
|---|---|
| `pnpm --filter @naql/api exec vitest run` with disposable PostgreSQL | **18 files passed; 151/151 tests passed; 0 skipped.** |
| Playwright full suite against API `4001` / web `3100` | **3/3 passed** in 1.5 minutes. |
| `pnpm test:isolated` (single final combined run) | **Exit 0.** Temporary PostgreSQL at `127.0.0.1:56144/naql_ai_phase41_test`; 8 migrations applied; 20 reference ports seeded; API **151/151**; Playwright **3/3** (41.8s, 15.5s, 6.2s). |
| `pnpm typecheck` | **5/5 runnable tasks passed** (API, web, shared-types, ui, validation). The empty `packages/config` project is intentionally excluded. |
| `GET /ready?detailed=1` | Returned database `AVAILABLE`, AI `NOT_CONFIGURED`, PDF/OCR `UNAVAILABLE` (extraction service not running), object storage `UNVERIFIED`, email `NOT_CONFIGURED`; no credentials exposed. |
| Phase 4 migrations | `20261022010000_phase4_rfq_lifecycle` and `20261024090000_phase4_notification_delivery` applied to the test and dev databases; eight migrations present. |

### Not verified / not run

- Real third-party AI inference, commercial trade data, email/WhatsApp delivery, carrier/AIS tracking, customs/Nafeza, maps, durable object storage, or malware-scanner operations. The registry reports them as unconfigured or unverified.
- Real OCR on scanned PDFs/images. Native Tesseract is absent; PDF text extraction is the verified path.
- Staging/production deployment, production migration, live credentials, disaster-recovery restore against production-like infrastructure, and production security sign-off.
- Python AI-service production packaging/build; no production build target is configured for that service.
- Every organization portal category through a dedicated browser persona. Navigation is permission-driven and the customer/provider paths are browser-tested; admin, carrier, customs, warehouse, and other categories are covered by API/permission tests or UI presence, not by a full browser workflow each.

Until real credentials and production-like infrastructure are supplied, do not claim full production readiness.
