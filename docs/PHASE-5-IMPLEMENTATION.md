# NAQL AI — Phase 5 Implementation

## Status

**Overall status: `PARTIALLY_IMPLEMENTED`.** Phase 5 was delivered as an extension of the existing organization-scoped commercial workflow. The core marketplace flow is `IMPLEMENTED_AND_TESTED`; live external integrations and production readiness are not. It does **not** introduce a second RFQ/quote system and does **not** claim live carrier pricing, availability, external RFQ distribution, or confirmed external bookings.

| Area | Classification |
|---|---|
| Public provider directory with provenance, registration distinction and filters | `IMPLEMENTED_AND_TESTED` |
| Directory registration entry point and consent-based public contact | `IMPLEMENTED_AND_TESTED` |
| Customer/provider registration split, importer/exporter/both intent and shared login | `IMPLEMENTED_AND_TESTED` |
| Provider organization classification and server-side provider-only RFQ guard | `IMPLEMENTED_AND_TESTED` |
| Explicit provider-profile transition; registration and verification separated | `IMPLEMENTED_AND_TESTED` |
| Existing-organization account-level backfill | `IMPLEMENTED_BUT_NOT_FULLY_VERIFIED`; fresh-schema migration and legacy tokens tested, no production-like data drill |
| RFQ draft/submit/cancel, richer cargo/commercial fields and activity history | `IMPLEMENTED_AND_TESTED` |
| Invited RFQs and explicit marketplace discovery/join | `IMPLEMENTED_AND_TESTED` |
| Quote revisions, per-component provenance and unknown/excluded charges | `IMPLEMENTED_AND_TESTED` |
| Currency-separated quote comparison | `IMPLEMENTED_AND_TESTED` |
| Atomic single-winner acceptance, booking and shipment linkage | `IMPLEMENTED_AND_TESTED` (existing invariants retained and re-tested) |
| RFQ documents with visibility rules and signed-content validation | `IMPLEMENTED_AND_TESTED` |
| In-app lifecycle notifications with dedupe | `IMPLEMENTED_AND_TESTED` |
| External email/WhatsApp/SMS/push delivery | `NOT_IMPLEMENTED` or `UNVERIFIED`; not claimed |
| Live carrier/rate/availability booking integration | `NOT_IMPLEMENTED` |
| Real malware scanning, production object storage, OCR/AI | `BLOCKED`/`NOT_CONFIGURED` as documented in Phase 2–4 |

## Data model and migration

Additive migrations:

- `apps/api/prisma/migrations/20261024120000_phase5_marketplace/migration.sql`
- `apps/api/prisma/migrations/20261025120000_account_types/migration.sql`

Neither has been applied to production. The account migration was applied only to the disposable isolated test cluster.

### Organization account classification

- `accountType`: `customer | provider`, default `customer`. This is a workspace classification, not a role and not platform authority.
- `tradeRole`: `importer | exporter | both | null` for the organization’s own external-trade activity. `null` is retained for legacy/general customers.
- Existing organizations default to `customer`. The migration backfills `provider` for organizations that already own a non-`importer_exporter` company.
- Existing memberships, roles, session versions, verification rows and company data are not rewritten.
- Check constraints restrict `accountType` and `tradeRole` to the documented values.

### Company

- `nameAr`, `nameEn` optional localized names; canonical `name` preserved.
- `recordOrigin`: `user_registered | manually_entered | imported`.
- `dataSource`, `sourceUrl`, nullable `lastVerifiedAt`.
- `publicContactConsent` defaults `false`; email and phone remain private unless explicitly consented.
- `pricingIntegrationStatus`, `availabilityIntegrationStatus`: `NOT_CONFIGURED | UNAVAILABLE | UNVERIFIED | AVAILABLE | DEGRADED`.

Persisted verification values were not renamed, because existing records and clients already use the lowercase contract. They map to the requested states as follows: `unverified` (public, never reviewed) and `unregistered` (registered profile not yet reviewed) → `UNVERIFIED`; `pending` → `PENDING_REVIEW`; `verified` → `VERIFIED`; `rejected` → `REJECTED`. A migration to uppercase strings would have broken existing rows and was intentionally avoided.

### CompanyService

- `serviceType` optional finer category such as `ocean_freight`, `customs_clearance`, `warehousing`.
- `shipmentTypes` text array, for example `FCL`, `LCL`, `GENERAL_CARGO`.

### Rfq

Additive nullable/defaulted fields: volume, package/container counts, container type, required service, preferred pickup/delivery dates, latest delivery date, cargo value/currency, hazardous flag, special requirements, `discoveryMode` (`invited` default, `marketplace`), cancellation actor/time/reason.

### Quote and QuoteItem

- Quote: notes, terms, service details, route details, pricing source, confidence, unknown charges, excluded services, revision number, `supersedesQuoteId`, submitting user.
- QuoteItem: optional flag, charge type, pricing source, confidence, source reference, notes.
- `Quote.supersedesQuoteId` is unique; a revision chain is therefore auditable and cannot fork into two direct successors.

### RfqDocument

Separate from shipment documents and company verification documents. Stores organization, type, sanitized filename, server-generated storage key, content type, size, SHA-256, malware-scan status/detail, visibility (`providers | private`), uploader and status.

## Account registration and onboarding

Registration remains shared login with distinct onboarding:

1. **Customer** — registration requires an importer/exporter/both choice (the API accepts `tradeRole`; UI validation requires it). The organization is created as `accountType=customer`; no provider role or verification is granted. The customer lands on the customer dashboard and can create RFQs/shipments.
2. **Provider** — registration collects a required organization name and creates `accountType=provider`. The user is sent to `/company/register?onboarding=provider` to create the provider profile. Before an eligible company exists, the provider inbox/opportunities return empty; the user does not receive another organization or an administrator role.
3. **Provider profile** — selecting a logistics category creates a `Company` profile in the caller’s organization. For an organization registered as a customer, this is the explicit transactional upgrade to `accountType=provider`; an organization registered as a provider is already classified. A legacy `importer_exporter` company profile does not upgrade the organization and cannot quote or join the marketplace.
4. **Employees** — accept an invitation and switch organizations. Their provider access comes from the destination organization’s `accountType`, membership role and permissions. They cannot use another organization’s provider workspace.
5. **Trade role** — an owner/admin with `company.settings.manage` can change `tradeRole` via `PATCH /api/v1/company/account`. The endpoint accepts only `tradeRole`; it cannot set account type, verification, platform role or membership.
6. **Platform administrators** — admin-scoped tokens are rejected by company/provider routes (`company_session_required` / `provider_session_required`). Platform authority remains in `User.platformRole` and admin scope.

The registration API treats unknown or privilege-looking `accountType` values as `customer`. Only `provider` (or the legacy UI synonym `company`) selects a provider organization. Client-supplied classification never grants a role.

## Provider-only RFQ boundary

`GET /rfqs/incoming`, `GET /rfqs/opportunities`, `POST /rfqs/:id/join`, `POST /rfqs/:id/quotes` and quote withdrawal now require:

1. an application session (not admin scope);
2. the relevant company permission (`rfqs.read` / `quotes.submit`);
3. `Organization.accountType=provider`;
4. the existing company ownership/eligibility and RFQ relationship checks.

A customer organization receives `403 provider_account_required` even if its membership has `COMPANY_OWNER`. A provider employee without `quotes.submit` is denied by the permission check. A different provider organization remains denied by the RFQ relationship check. This makes the provider boundary server-side and independent of frontend navigation.

## Public directory

`GET /api/v1/companies/directory` supports:

- text query over Arabic/English names, description and services;
- category (`type`);
- mode (`SEA`, `AIR`, `LAND`, `RAIL`, `MULTIMODAL`);
- service type;
- coverage (origin/destination/notes);
- verification status;
- registered vs public-only;
- bounded pagination.

The public view returns no organization ID, private contact, verification documents or account credentials. Contact fields are returned only when the company explicitly consented. `isRegistered`, `recordOrigin`, `dataSource`, `sourceUrl`, `lastVerifiedAt` and both integration statuses are separate from verification.

Seed shipping lines are public directory candidates only:

- Maersk, MSC, CMA CGM, Wan Hai Lines, Hapag-Lloyd, COSCO Shipping Lines, Evergreen Marine, ONE, Yang Ming, ZIM, Arkas Line.
- Official corporate website and source URL are recorded.
- `verificationStatus=unverified`, `lastVerifiedAt=null`, no organization, no Egyptian office/agent/coverage claim, and `NOT_CONFIGURED` pricing/availability integrations.
- The seeder skips any slug that already belongs to a real registered organization.

The categories supported by provider registration/filtering are: freight forwarder, ocean carrier, shipping agent, road carrier, air cargo provider, customs broker, warehouse/storage, multimodal provider, plus the legacy `carrier` value. The legacy `importer_exporter` company type remains readable for existing records but is not offered as a provider onboarding category and is never eligible to quote. Shipping line and local Egyptian agent are not combined into one record.

## RFQ lifecycle

1. **Create** as `draft` or `submitted` with customer organization ownership and optional invited recipients.
2. **Submit draft** explicitly. Drafts are excluded from provider inboxes and provider detail access.
3. **Cancel** by the owner with a mandatory reason. Cancellation is transactional, rejects still-open quotes with a reason, records actor/time/reason, and emits notifications.
4. **Provider inbox** requires a provider-classified organization and exposes only RFQs addressed to a company owned by that organization and only after submission.
5. **Activity history** returns persisted RFQ/quote/booking/shipment events. Providers see only their own quote/booking events and never competing quotes or customer user identities.
6. **Marketplace** is opt-in per RFQ:
   - discovery returns a limited view to registered providers whose company category/mode can serve the RFQ;
   - no customer organization, creator, contact, private documents or competitor quotes are returned;
   - a provider must explicitly join before receiving the normal incoming-RFQ and quoting access;
   - joining is idempotent and audited; re-joining does not duplicate records or notifications.

No external RFQ distribution is claimed.

## Quote lifecycle and pricing integrity

Providers can submit, withdraw, and submit a new revision. Acceptance remains owner-only and transactional.

Validation and presentation rules:

- every item has an ISO-4217-shaped three-letter currency and must use the quote currency;
- negative or malformed amounts are rejected;
- excluded and optional items are never added to the headline total;
- unknown charges are represented as text and are never treated as zero;
- at least one included, non-optional positive charge is required;
- estimated/calculated pricing cannot be marked `confirmed`;
- a published-tariff quote must carry a source reference or note;
- per-item and quote-level pricing source/confidence are preserved;
- revision number and predecessor link are persisted;
- comparison groups quotes by currency and never converts or combines currencies;
- comparison exposes service differences, unknown/excluded charges and a non-recommendation disclaimer.

The UI labels a provider-stated “confirmed” price as confirmed by the provider, not verified by NAQL AI.

## Acceptance, booking and shipment

Existing Phase 4 invariants were retained:

- customer ownership and `quotes.accept` permission;
- quote must be valid, open and belong to the RFQ;
- advisory transaction lock and one winner;
- competing quotes rejected with actor/time/reason;
- one booking and linked shipment;
- concurrent duplicate acceptance returns the same booking idempotently;
- an accepted RFQ cannot be cancelled;
- provider access is limited to its own quote and booking.

Booking status is internal. It is not proof of a confirmed external carrier booking.

## Documents

- Customer owner uploads with a valid company role and `rfqs.create`.
- Server validates actual bytes, extension and declared type; PDF/PNG/JPEG are accepted by the RFQ UI.
- Storage key is generated by the server; client-supplied keys are not accepted.
- `private` documents are hidden from providers. `providers` documents are available only to invited/joined providers and never to unrelated organizations.
- Download responses use `application/octet-stream` fallback where applicable, `nosniff`, private no-store caching, and a safe encoded filename.
- Malware scanning reports the actual scanner state; no clean result is invented.
- RFQ documents are not included in external email or notification bodies.

## Notifications

New in-app types: `RFQ_SUBMITTED`, `RFQ_CANCELLED`, `MARKETPLACE_JOINED`.

- Recipient organization and dedupe key are explicit.
- Notification bodies contain route-level context only, not customer contacts, private documents or competitor quotes.
- Retried submissions do not duplicate notifications.
- No email, WhatsApp, SMS or push delivery is claimed. The existing optional Resend adapter remains unverified unless a real delivery is performed.

## UI

- Public directory: search, category/mode/service/coverage/verification/registration filters, pagination, loading/error/empty states, provenance and integration labels.
- Public profile: registered/public and verified/unverified distinctions, consent-based contact, source, review date, services and registration entry point.
- Registration: explicit customer vs provider cards; customer importer/exporter/both selector; provider organization-name requirement; provider redirect to the profile onboarding.
- Company registration: provider categories, Arabic/English names, contact consent, service and coverage fields, and an onboarding notice explaining the provider classification transition.
- Customer RFQ create/list/detail: commercial fields, draft save, submit, cancel, documents, quote comparison and activity.
- Provider inbox: marketplace opportunities and explicit join; provider detail shows limited RFQ data, its own quote history, provenance and revision. The navigation link is hidden for customer accounts and server-enforced regardless.
- Dashboard and shell: account-kind/trade-role labels, customer/provider-specific actions, provider-only inbox navigation gated by `kind==="provider"` and company presence.
- Settings: trade-role update card available only with `company.settings.manage`; account type is displayed but not client-writable.
- Notification labels updated for the new types.
- Arabic RTL and English/ltr utility conventions are preserved; no new dependency was added.

## Security review summary

Changed routes were reviewed for authentication, organization ownership, IDOR, provider eligibility, document visibility, validation, pagination, duplicate handling, concurrency, uploads, audit and secret leakage.

Key negative controls:

- customer organization cannot use provider inbox/opportunities/join/quote routes even with `COMPANY_OWNER`; the API returns `provider_account_required`;
- provider employee without `quotes.submit` cannot quote; a different provider organization remains denied by the RFQ relationship check;
- registration with `accountType=admin`/`root` or another unknown value remains a customer and receives no platform or provider authority;
- provider profile creation is the only route that upgrades `customer` to `provider`; legacy `importer_exporter` does not;
- account type/trade role changes cannot set platform role, membership or verification;
- admin-scoped tokens cannot use company/provider workspace routes;
- uninvited provider and unrelated organization cannot read RFQ detail, activity, documents or comparison;
- marketplace candidates cannot see customer identity or competing quotes before/without joining;
- provider detail response strips `organizationId`, `createdByUserId`, `cancelledByUserId`, bookings and non-owned quotes;
- public directory is a projection, not a raw Company row;
- document storage keys and malware details are not exposed;
- non-owner cannot accept, cancel, submit another organization's draft or upload customer documents;
- currencies are validated and never converted;
- pessimistic/advisory locking prevents double winners;
- accepted RFQs are immutable through the cancel path.

## Known limitations

- Importer, exporter and both are classification/onboarding intents only. They do not create separate permissions or a duplicate account for each direction.
- Provider verification remains an administrator review; account registration and public directory presence are not verification.
- The migration backfill was reviewed and applied to a fresh isolated schema. A production-like drill with pre-existing organizations is not authorized in this pass.
- No live shipping-line/carrier rate, capacity, availability, AIS or booking adapter.
- No Egyptian-agent/coverage verification for seeded international carriers.
- No ratings, reviews, price estimates or service claims invented.
- No external RFQ distribution.
- No carrier booking confirmation; only internal booking request/confirmation.
- Real ClamAV and production object storage are not configured; scan status is reported honestly.
- Email delivery is configuration-dependent and unverified; WhatsApp/SMS/push are not implemented.
- Dedicated carrier/airline/customs/warehouse portals are represented by the shared provider workspace, not separate applications.
- Production migration, staging review and load/security testing are outside this pass.

## Files changed (main)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20261024120000_phase5_marketplace/migration.sql`
- `apps/api/prisma/migrations/20261025120000_account_types/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/auth/account.ts`
- `apps/api/src/auth/principal.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/company.ts`
- `apps/api/src/app.ts`
- `apps/api/src/companies/routes.ts`
- `apps/api/src/company/routes.ts`
- `apps/api/src/rfq/routes.ts`
- `apps/api/src/notifications/service.ts`
- `apps/api/src/admin/companies.ts`
- `apps/api/scripts/db-tables.ts`
- `apps/api/src/__tests__/phase5-marketplace.test.ts`
- `apps/api/src/__tests__/account-separation.test.ts`
- `apps/web/app/register/page.tsx`
- `apps/web/app/(app)/dashboard/page.tsx`
- `apps/web/app/(app)/settings/page.tsx`
- `apps/web/app/directory/page.tsx`
- `apps/web/app/directory/[id]/page.tsx`
- `apps/web/app/(app)/company/register/page.tsx`
- `apps/web/app/(app)/rfqs/page.tsx`
- `apps/web/app/(app)/rfqs/[id]/page.tsx`
- `apps/web/app/(app)/provider/rfqs/page.tsx`
- `apps/web/app/(app)/provider/rfqs/[id]/page.tsx`
- `apps/web/app/(app)/notifications/page.tsx`
- `apps/web/components/layout/AppShell.tsx`
- `apps/web/components/providers/AuthProvider.tsx`
- `apps/web/lib/auth.ts`
- `apps/web/e2e/phase5.spec.ts`
- `apps/web/e2e/accounts.spec.ts`
- Phase 5 docs and `IMPLEMENTATION_STATUS.md`
