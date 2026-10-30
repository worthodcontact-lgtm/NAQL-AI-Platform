# NAQL AI — Phase 5 Tests

## Final verified result

The final combined isolated run exited **0**.

| Stage | Result |
|---|---|
| Isolated PostgreSQL startup and database verification | Passed; throwaway cluster on `127.0.0.1:51023`, database `naql_ai_phase41_test` |
| Prisma migrations | **10/10 applied**, including `20261024120000_phase5_marketplace` and `20261025120000_account_types`; `migrate status` reported up to date |
| Seed | 20 ports, 11 directory candidates; candidates created unverified and integration-free |
| API tests | **167 passed / 167**, 20 files, zero skipped |
| Playwright Chromium tests | **7 passed / 7**, one worker |
| Root typecheck | **5/5 runnable projects passed** |
| Production build | **2/2 tasks passed** (API + Web; 36 web routes) |

The API and browser stages used the same disposable database in that run. The runner verifies the loopback host, random port and test database before applying migrations. It does not use `.pgdata`, a development database, staging or production. The temporary cluster was cleaned up by the runner.

## Commands and exact outcomes

| Command | Outcome |
|---|---|
| `pnpm typecheck` | Exit 0. `@naql/api`, `@naql/web`, `@naql/shared-types`, `@naql/ui`, `@naql/validation` passed. `@naql/config` is in Turbo scope but has no typecheck task. |
| `pnpm test:isolated` | Exit 0 on the final run. 10 migrations applied, API 167/167 in 20 files, Playwright 7/7, zero skips. |
| `pnpm build` | Exit 0. API Prisma generation + TypeScript build and Next.js optimized production build succeeded; 2/2 tasks and 36 web routes generated. |

### Browser-run history

The first Phase 5 isolated run passed **158/158 API tests** (the count before the account tests were added) but had **2 passed / 3 failed** browser tests:

- one existing lifecycle locator waited on a page whose snapshot showed a Next.js dev Fast Refresh page error (`Invalid or unexpected token`);
- the directory test used an ambiguous `getByText("سجل عام")`;
- the marketplace join locator matched two eligible marketplace cards and therefore collided in Playwright strict mode.

The directory assertion was scoped to the Maersk card, and the marketplace opportunity card received a stable `data-testid` so the test targets its own RFQ instead of another eligible opportunity left by the API test. The final run was executed without editing source files during the run. It passed all five browser tests.

The first browser failure is reported here rather than hidden. It was a development-server/Fast Refresh artifact, not an authorization failure; the rerun exercised the complete lifecycle successfully.

After the account-separation tests were added, an interim browser stage passed **6/7**. The existing lifecycle test clicked the provider RFQ link and did not see the URL change within 10 seconds while the Next.js dev server logged `[Fast Refresh] rebuilding` and took 3.5 seconds to rebuild. That rebuild was caused by editing an e2e test file while the dev server was live, which is a test-harness artifact rather than an access-control failure. The clean final run was executed with no concurrent file edits and passed **7/7**, including the same lifecycle journey.

## New API coverage

`apps/api/src/__tests__/phase5-marketplace.test.ts` — 7 tests:

1. **Public carrier candidates** — Maersk is present, unverified, unregistered, has no organization ID, and does not claim live pricing.
2. **Directory filters and pagination** — category, mode, service type, coverage, verification state, registered/public-only, and page bounds.
3. **Draft/submit/cancel and visibility** — draft hidden from providers; explicit submit works; cancellation records actor/time/reason, rejects open quotes, and blocks provider access after cancellation; accepted RFQs cannot be cancelled.
4. **Marketplace discovery and join** — eligible registered providers see a limited RFQ view; customer organization, creator, contact, private documents and competing quotes are absent; mismatch/non-eligible companies cannot join; cross-organization detail access is denied; join is explicit and idempotent.
5. **Pricing provenance and integrity** — per-item charge type/source/confidence, currency must match, mixed currencies rejected, negatives rejected, unknown and excluded amounts not treated as zero, estimated pricing cannot be marked confirmed, revisions retain predecessors, comparison groups currencies separately.
6. **Atomic acceptance** — concurrent acceptances produce one winning quote, one booking and one linked shipment; a retry returns the same booking; losing quotes are rejected; notifications are deduplicated; accessing another organization's quote/booking is denied.
7. **RFQ documents** — owner-only upload, provider-visible document access, private document hidden from provider, unrelated organization denied, content/type checks, no storage-key leakage.

`apps/api/src/__tests__/account-separation.test.ts` — 9 tests:

1. **Importer/exporter/both persistence** — all three trade intents register, log in and are returned by `/auth/me` as the same customer account type with the same customer RFQ flow.
2. **Trade-role update** — `PATCH /company/account` changes `importer` to `both`; account type remains customer and the new value is read from PostgreSQL on the next request.
3. **Privilege-looking registration** — `accountType: "admin"` is persisted as customer, receives no platform role and is denied the provider inbox.
4. **Provider registration/login** — the organization name is persisted; the account has no platform role or verification; the provider workspace is empty before a company profile, then has a draft, unverified forwarder profile with a service category.
5. **Customer-to-provider escalation denial** — a customer can create RFQs but receives `provider_account_required` on incoming/opportunities/join/quote routes until it explicitly creates a provider company; the old token then reads the upgraded classification.
6. **Provider employee permissions** — an invited `VIEWER` in a provider organization gets provider classification after switching, can read the inbox, but cannot quote without `quotes.submit`.
7. **Cross-organization denial** — an invited provider can open the customer RFQ; a different provider organization is denied.
8. **Platform administrator isolation** — an admin-scoped token cannot use the provider inbox or company workspace; `/auth/me` retains platform role and admin scope.
9. **Legacy-token compatibility** — a token minted without classification still authenticates; the principal is rebuilt from PostgreSQL and sees the organization’s current provider/trade classification.

The full suite also retained prior coverage for admin separation, Phase 3 operations, access separation, company verification, RFQ tenant isolation, PostgreSQL persistence, storage, notifications, AI fallback, trade data, and backup table enumeration.

## Browser coverage

`apps/web/e2e/phase5.spec.ts`:

1. **Public directory honesty** — searches Maersk, verifies “public record”, “unverified”, “pricing not connected”, “no independent verification”, and the official website.
2. **Marketplace journey** — customer creates a marketplace RFQ; an eligible provider sees only the limited opportunity, explicitly joins, submits a quote with source/confidence and an unknown charge; customer opens comparison, sees the unknown charge and service differences, accepts, and reaches the linked booking/shipment state.

`apps/web/e2e/accounts.spec.ts`:

1. **Customer registration** — selects customer, chooses importer/exporter/both, lands on the customer dashboard, sees the trade role, sees customer navigation and does not see the provider inbox.
2. **Provider registration/onboarding** — selects provider, requires an organization name, lands on `/company/register?onboarding=provider`, sees provider portal labeling, creates a provider company profile and then sees the provider inbox navigation. The profile remains unverified.

`apps/web/e2e/lifecycle.spec.ts` still passes the pre-existing customer/provider quote, withdrawal, resubmission, acceptance, booking, shipment, notification and cross-organization denial journeys. `apps/web/e2e/rfq.spec.ts` still passes the customer RFQ creation flow.

## Security and negative assertions covered

- Customer organization cannot use provider inbox/opportunities/join/quote routes; `provider_account_required`.
- Provider employee without `quotes.submit` cannot quote; provider classification does not bypass membership permissions.
- Registration with a privilege-looking account type remains customer; provider profile creation is the explicit upgrade; legacy `importer_exporter` does not upgrade.
- Admin-scoped token cannot use provider/company workspace routes.
- Legacy token without classification is resolved from current PostgreSQL state.
- Cross-organization RFQ, quote, booking, shipment and document denial.
- Uninvited provider cannot list or open an invited RFQ.
- Provider view omits owner organization, creator, private documents, competing quotes and owner bookings.
- Marketplace preview omits the same sensitive fields before joining.
- Non-eligible category/mode cannot join; non-owned company cannot join on behalf of another organization.
- Draft cannot be read by providers; cancelled RFQ cannot be quoted or cancelled again.
- Owner-only acceptance and cancellation; accepted RFQ cannot be cancelled.
- Quote currency matching, malformed/negative amount rejection, unsourced published tariff rejection.
- Concurrent acceptance single winner and retry idempotency.
- Private RFQ document hidden from providers; unrelated organization receives not-found.
- Public directory/projection excludes organization ID and unpublished contact details.
- Notification recipient scoping and dedupe; no competitor/customer-private data in bodies.

## Explicitly not proven

- Real email, WhatsApp, SMS or push delivery.
- Live carrier pricing, capacity, availability, booking, AIS, customs or port integration.
- Real ClamAV scanning; the test environment reports the scanner as unavailable rather than clean.
- Real OCR/Tesseract and real AI inference.
- Production S3/object storage.
- Production migration, staging security review, load test, penetration test, backup restore and deployment.
- A production-like account-classification backfill drill against a copy of real pre-existing organizations. The migration was applied to the fresh isolated schema and legacy-token compatibility is tested; production data migration is not authorized.
- Independent verification of Egyptian offices, agents or port coverage for the seeded international shipping lines.
- A browser-driven admin approval of a seeded directory candidate. The admin approval path sets `lastVerifiedAt` and the existing admin API verification tests pass, but the new Phase 5 browser test does not drive that admin decision.
- Dedicated carrier/airline/customs/warehouse portals beyond the shared provider workspace.

## Manual verification

- Reviewed the public directory/profile projections and confirmed they return a safe field set rather than raw `Company` rows.
- Reviewed provider RFQ responses for removal of `organizationId`, creator identity, private documents and non-owned quotes.
- Reviewed comparison arithmetic and presentation for currency separation, unknown charges and service differences.
- Reviewed acceptance/cancellation transaction boundaries and retry behavior.
- Reviewed the account-classification migration, provider guard ordering and the explicit company-profile transition; confirmed unknown account types normalize to customer.
- Ran the real browser journeys for customer/provider registration and provider onboarding, plus directory, marketplace join, quotation and comparison already described above.

No production credential, production database, deployment, commit or push was used.
