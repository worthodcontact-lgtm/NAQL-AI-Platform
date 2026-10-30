# Phase 4.1 Database and E2E Verification

> **2026-10-24 superseding result:** the current browser suite covers customer, provider, and security workflows in `apps/web/e2e/lifecycle.spec.ts` plus the original RFQ spec. Final `pnpm test:isolated` combined run exited 0: **151/151 API tests in 18 files**, **3/3 Chromium tests**, eight migrations applied to a temporary PostgreSQL cluster. The historical sections below describe the earlier Phase 4.1 state and should not be read as the current browser coverage. See [Phase 4 E2E test status](./PHASE-4-E2E-TESTS.md) for current commands, coverage, and blockers.

## Run it

Install the Chromium browser for the installed Playwright version, then run:

```powershell
pnpm --filter @naql/web exec playwright install chromium
pnpm test:isolated
```

The isolated runner provisions a temporary PostgreSQL cluster and starts the API and Next.js app with separate local test ports. It migrates and seeds only that throwaway database, runs all API tests (including PostgreSQL-backed tests), runs the browser suite, then stops the cluster and removes its temporary directory. It refuses to migrate unless the configured target matches the selected loopback host, random port, and test database name. The persistent `.pgdata` cluster is never used.

The browser test can also be run separately with `pnpm --filter @naql/web test:e2e` when an API and web server are already running at ports 4001 and 3100 and the database has reference port data.

## Coverage

| Layer | Flow | Evidence |
|---|---|---|
| PostgreSQL API tests | Registration, companies, RFQ and quotation submission/withdrawal/resubmission, acceptance, booking, linked shipment, permissions, milestones, documents, costs, notifications and persistence | Tests execute with PostgreSQL enabled, not skipped |
| Browser E2E | Register a customer through the API fixture, sign in through the UI, create an RFQ through the form, and confirm it appears in the RFQ list | Chromium-driven Playwright test |
| Registry | Configuration, connectivity, and operation signals are separate; health checks and provider status don't claim an unperformed operation | Unit tests cover configured/failed and probe-only states |
| Cost assessment | Missing components stay unknown; incomplete input has no total; mixed currencies fail validation | Unit/API regression tests |

The browser test covers the customer RFQ screen. Quote revisions, acceptance idempotency, booking ownership, shipment creation and event transitions are exercised against the real PostgreSQL API through integration tests; they are not currently automated as a second browser persona flow.

## Results

### Final recorded runs (2026-10-22)

| Command / stage | Result |
|---|---|
| `pnpm --filter @naql/api run test:isolated` — full Vitest stage | **17 files passed; 146 tests passed; 0 skipped.** The PostgreSQL persistence workflow and all PostgreSQL-enabled tests ran. Seven migrations applied; `migrate status` reported schema up to date; seed created 20 reference ports. |
| Same unfiltered runner, Playwright stage | The API stage passed, but the outer command exited nonzero because the then-current browser assertion looked for cargo text in the RFQ list. The list intentionally shows route/status; the test was corrected to open RFQ details. |
| `pnpm --filter @naql/api run test:isolated -- src/__tests__/postgres-persistence.test.ts` — final focused run | **2/2 PostgreSQL persistence tests passed; 1/1 Playwright test passed.** Browser duration: **15.9 seconds**. Browser steps: create a fresh customer fixture via API; sign in through `/login`; select Alexandria Port (ALY) and Port Said (PSD); enter cargo description and weight; submit the RFQ; verify the route in the list; open Details and verify the cargo description. |
| `pnpm typecheck` | **5/5 tasks passed**: `@naql/api`, `@naql/web`, `@naql/shared-types`, `@naql/ui`, `@naql/validation`. Turbo scope contains six packages. `@naql/config` has no `typecheck` task because it contains only the shared compiler base config and has no TypeScript project/source; it is intentionally excluded, not silently skipped. |
| `pnpm build` | **2/2 tasks passed**: `@naql/api` (Prisma Client generation and TypeScript production compilation) and `@naql/web` (Next.js optimized production build; 36 static/dynamic routes). The initial Google Fonts request retried; compilation and build completed successfully. Shared packages have no `build` scripts. `apps/ai-service` is outside the pnpm workspace and has no production build command/configuration, so it was not built by `pnpm build`. |

The test database name was **`naql_ai_phase41_test`**, bound to a random port on `127.0.0.1` in a unique temporary PostgreSQL cluster. The runner verified host, port, and database name before migration. It never connected to `.pgdata`, the development `naql_ai` database, or a production URL. Seven migrations and seed data were confined to this temporary cluster. No production migration or deployment was performed.

Earlier iterations had failed checks while the assertions and fixtures were being stabilized: an initial full database run had five failures, a later run had a seeded-port fixture assertion failure, and early browser attempts exposed an unassociated label, an unsupported regex option label, and the incorrect expectation that the RFQ list displays cargo description. Those issues were corrected. The final full API suite and final focused browser run above are the successful evidence; the earlier failures are not reported as final passing results.

All quote, booking, shipment, organization-isolation, and concurrency claims in the API section above are based on the 146-test Vitest log: RFQ-to-quote and booking workflow, quote withdrawal/resubmission, idempotent and concurrent single acceptance, linked shipment creation, validated shipment milestones, cross-organization access denial, and fresh-process persistence all passed in that run. The final focused rerun additionally passed both PostgreSQL persistence tests. These business flows were not driven through separate customer and provider browser sessions; the browser test ends at RFQ Details.

The full unfiltered combined runner was not rerun after correcting the browser-only assertion: its API stage already passed 146/146, and the corrected browser test was verified in the final focused isolated run. Thus component results are green, while there is no single final unfiltered runner invocation with exit code 0 in the recorded log.

One stopped temporary cluster directory from the first failed runner attempt remains under the Windows temp directory (`naql-ai-phase41-pg-1oHXQF`). No PostgreSQL process was running for it when checked. The operating-system command policy rejected the requested recursive removal of that generated directory; no repository or prior user file was targeted. All subsequent runner invocations completed their normal cleanup. This residue is isolated test data, not production data.

### Not verified / not run

- Full browser workflow with a provider persona through quote revision, acceptance, booking confirmation, shipment view, and milestone entry. API tests cover the corresponding lifecycle, but browser coverage does not.
- Real third-party AI inference, commercial trade data, email/WhatsApp delivery, carrier/AIS tracking, customs/Nafeza, maps, durable object storage, or malware-scanner operations. These are not configured or remain unverified as shown by the integration registry.
- Staging/production deployment, production migration, live credentials, disaster-recovery restore against production-like infrastructure, and production readiness/security sign-off.
- Python AI-service production packaging/build; no build target is configured in this repository.
