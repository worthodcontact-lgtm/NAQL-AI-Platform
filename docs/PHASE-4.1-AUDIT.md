# Phase 4.1 Stabilization Audit

> **Superseded 2026-10-24:** the current closure passed **151/151 API tests**, **3/3 Chromium tests**, root typecheck **5/5**, and production build **2/2** in the combined `pnpm test:isolated` run. The 15.9-second single-browser and 146-test observations below are historical.

**Date:** 2026-10-22  
**Repository:** `E:\naql ai`  
**HEAD:** `84f11c2df314e02acfd44369bb1c217de8bf1cc4` (`main`)  
**Working tree:** Large existing uncommitted Phase 1–4 changes across API, web, schema/migrations, AI service, tests, docs, and environment files. No reset/stage/commit has been performed. These changes are preserved.

## Scope

Read all Phase 4 audit, implementation, API, integrations, and E2E docs; Phase 4 setup and implementation status; root/API/web package scripts; Turbo tasks; all repository TypeScript configurations; current RFQ/quote/booking/shipment routes and schema; migration SQL; registry and cost code; PostgreSQL test setup and scripts.

## Baseline verification before Phase 4.1 fixes

From the preceding stabilization turn:

| Check | Result |
|---|---|
| `pnpm typecheck` | Failed with `TS18003` because Turbo discovered `packages/config`'s `typecheck` script, which ran `tsc -p tsconfig.base.json` on a shared base config with no source files. |
| `pnpm --filter @naql/api run typecheck` | Passed after integration registry/test changes. |
| `pnpm --filter @naql/web run typecheck` | Passed. |
| `pnpm build` | Passed; API build and 36 Next routes. |
| Safe no-DB API suite | 90 passed, 50 skipped. Database-backed cases were not executed. |
| Focused registry + pricing tests | 3 passed. |
| `prisma validate` | Passed. |
| Test DB migration status/full DB suite | Not run; no dedicated test DB identified yet. |
| Browser E2E | Not implemented or run. |

## TypeScript architecture finding

`packages/config/tsconfig.base.json` is a shared compiler-options base used by `apps/api/tsconfig.json` and `apps/web/tsconfig.json` through `extends`. It is not a standalone project and there are no TypeScript source files in `packages/config`. The package `typecheck` script incorrectly treats this base as a project, causing the root Turbo typecheck to fail. The correct fix is to remove the package-level typecheck task; API and web remain independently checked by their own scripts.

## Database safety finding

The repository's existing Windows embedded PostgreSQL script starts a persistent cluster in `.pgdata` on port 5433 and reuses the existing `naql_ai` database. That is the user's development data and must not be used/reset for tests. PostgreSQL command-line tools are not available on PATH. Before database-backed tests, provision a separate temporary embedded PostgreSQL cluster with a unique data directory and port, apply migrations only there, run tests with shell `DATABASE_URL` overriding `.env`, then stop and remove only that isolated cluster. The temporary cluster must be verified by host, port, and database name before migration.

## Business-flow findings before this verification pass

- RFQ→quote→booking→shipment code and Phase 4 migration/tests exist in the working tree. Shipment creation requires validated route ports and Incoterm; legacy/free-text RFQs may create a booking without a shipment. This must remain explicit and no unrelated shipment may be attached.
- Quote resubmission uses a partial unique index for `submitted` quotes; winner uniqueness is a separate partial index. Existing route tests cover withdrawal, resubmission, expiry, concurrent submission, acceptance idempotency, and linkage, but database execution has not been verified during this phase.
- Admin integration registry distinguishes configuration from some live checks; provider integrations remain unverified. It does not establish overall platform readiness.
- Landed-cost calculator marks all results estimated, but currently takes required numeric inputs and treats user-entered fees/rates as values. It needs explicit incomplete/unknown cost coverage and regression tests before unknown charges can be safely represented.
- Browser E2E and complete customer/provider journeys are absent.

## Work performed

1. Removed the invalid shared-config typecheck task; final root typecheck passed all five runnable TypeScript projects.
2. Ran migrations and all database-backed API tests against a loopback-only temporary PostgreSQL cluster.
3. Corrected the seeded-port fixture assertion while preserving explicitly unverified test fixtures.
4. Added and ran a customer browser flow through RFQ Details using Playwright.
5. Added integration evidence fields and incomplete/unknown landed-cost behavior with regression tests.
6. Recorded results and remaining limitations in the Phase 4.1 implementation/E2E docs. No production changes.

## Phase 4.1 outcome

- Removed the invalid config-package typecheck task; root typecheck now reaches the actual app/package projects.
- Added a loopback-only temporary PostgreSQL runner, with migrations/status/seed, full API suite, and Playwright in one disposable database lifecycle. `.pgdata` remained untouched.
- Full API database run: **17 files passed, 146 tests passed, 0 skipped**. This covers RFQ, quote revisions/withdrawal, booking, shipment linkage/events, access isolation, persistence, costs, documents and integration evidence.
- Playwright: final corrected registration/login/RFQ creation test passed through RFQ Details in 15.9 seconds. The unfiltered combined runner was not repeated after a browser-only assertion correction; full API and corrected browser runs passed separately. Exact run boundaries are recorded in [Phase 4.1 E2E tests](./PHASE-4.1-E2E-TESTS.md).
- Root `pnpm typecheck`: 5/5 tasks passed across API, web, shared-types, UI and validation. Config is intentionally omitted because it only supplies a shared `tsconfig.base.json` and contains no TS project/source.
- Root `pnpm build`: 2/2 build tasks passed for API and web. Shared packages have no build scripts; Python `apps/ai-service` is outside the pnpm workspace and has no production build target.
- One stopped temporary test-cluster directory from the first failed runner remains in OS temp. The recursive removal command was rejected by OS command policy after the cluster stopped; subsequent isolated runs cleaned up normally. No active PostgreSQL process remained, and the temp database was isolated from `.pgdata`/production.
- Landed-cost incomplete/unknown provenance and integration configuration/connectivity/operation fields are implemented with regression coverage.
- No production data, deployment, commit, reset, or staging action was performed. Existing Phase 1–4 work remains uncommitted and preserved.
