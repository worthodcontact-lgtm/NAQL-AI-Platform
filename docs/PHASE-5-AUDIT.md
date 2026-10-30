# NAQL AI — Phase 5 Audit

## Scope and baseline

This audit covers the Phase 5 logistics-marketplace request and the repository state after Phase 4.2. The working tree already contained extensive uncommitted Phase 1–4 work; those changes were preserved. No reset, clean, commit, push, deployment, production migration, credential rotation or production data change was performed.

The required model extends, rather than replaces:

- `Organization` as the tenant boundary;
- `Membership` as the company workspace identity;
- `Company` as the provider profile;
- `User.platformRole` as platform staff authority;
- the existing RFQ → quote → acceptance → booking → shipment lifecycle, permissions, audit and notifications.

## What already existed

| Area | Existing implementation |
|---|---|
| Tenancy | Organization-scoped memberships and roles; platform staff separated from customer/provider authority |
| Provider profile | `Company`, `CompanyService`, verification reviews/documents, admin verification |
| RFQ | Invited-provider RFQs, customer-owned records, provider-safe projections |
| Quote | Itemized totals, validity, withdrawal, resubmission and expiry handling |
| Acceptance | Transactional single-winner acceptance with booking/shipment linkage and retry safety |
| Shipment | Persisted milestones, validated transitions, honest unavailable live tracking |
| Notifications | In-app rows, recipient scoping, dedupe, optional Resend adapter |
| Documents | Byte/signature validation, server keys, malware-status reporting |

The existing suite supplied evidence for the most security-sensitive transactional behavior. Phase 5 had to add marketplace discovery, provenance, richer commercial data and browser coverage without weakening those invariants.

## Gaps found

1. The directory had only a cursory text/verification filter and could not filter by category, mode, service, coverage or registration state.
2. The directory response did not distinguish a registered company from a public candidate, and did not expose source, source URL, last independent verification date, or pricing/availability integration state.
3. Contact details had no explicit publication-consent model.
4. Provider categories were incomplete for shipping agents, road carriers, air cargo and multimodal providers.
5. RFQs could not be saved as drafts, explicitly submitted, cancelled with a reason, or discovered through an opt-in marketplace.
6. There was no controlled pre-join marketplace view; exposing all RFQs to all providers would have leaked customer identity and commercial information.
7. Quote entries lacked component type, per-component provenance, optional/excluded semantics, unknown-charge representation and revision metadata.
8. Comparison had no currency separation or service-difference presentation, risking misleading cross-currency or headline-price comparisons.
9. RFQ-specific supporting documents did not exist as a separate visibility-controlled model.
10. There was no persisted RFQ activity timeline for lifecycle events.
11. Browser coverage did not exercise the public directory, marketplace join, quote provenance or the Phase 5 UI surfaces.
12. Registration displayed a customer/provider choice but did not submit it; the API registration schema ignored `accountType`.
13. `Organization` had no persisted customer/provider classification and no importer/exporter trade intent. The frontend inferred “company” from the mere existence of any `Company` row.
14. Every registrant received an organization and a `COMPANY_OWNER` membership. Provider-only RFQ routes relied on company ownership and role permissions but had no explicit provider-organization account guard.
15. The legacy `importer_exporter` company type was offered alongside logistics provider categories, conflating the customer’s trade activity with a provider profile.
16. A customer could create a provider company profile without a distinct onboarding step, and the resulting permission transition was implicit.
17. Existing verification, directory listing, organization membership and platform administration were already separate, but the registration UI did not explain or enforce those boundaries.

## Account and onboarding separation audit

The required separation was added as an extension of the existing tenant model, not as a second identity system.

| Concern | Before this pass | Resolution |
|---|---|---|
| Shared login | Already shared by all application accounts | Preserved; login returns the organization classification and trade role |
| Customer/provider registration | Choice was presentational only | Persisted on `Organization.accountType`; provider registration routes to provider onboarding |
| Importer/exporter intent | Represented only by a legacy company type | `Organization.tradeRole` = `importer | exporter | both | null` |
| Provider authority | Implied by owning a company plus role permission | Provider-only RFQ routes additionally require a provider-classified organization |
| Customer → provider transition | Implicit whenever a company row existed | Explicit provider-profile creation; legacy `importer_exporter` profile does not upgrade |
| Existing users | No migration path for classification | Additive migration defaults organizations to customer and backfills existing logistics-provider organizations |
| Platform administrators | Already separate via `User.platformRole` and admin token scope | Unchanged; admin-scoped tokens cannot use provider or company workspace routes |
| Verification | Separate review workflow | Unchanged; provider registration/profile creation never sets `verified` |
| Directory listing | Public projection without account authority | Unchanged; listing still creates no account and grants no portal/RFQ access |

### Design decisions

- **Account type is not a role.** `Organization.accountType` only classifies the workspace. `Membership` roles and the permission matrix still decide what a member may do; `User.platformRole` and admin token scope still decide platform authority.
- **Importer and exporter are not separate roles.** They use the same shipment, document, cost and RFQ flows. A single organization can be `both` without duplicate accounts; `null` remains for legacy/general customers that do not want to declare an intent.
- **Provider onboarding is explicit.** For a customer organization, creating a logistics `Company` profile is the transactional transition point; an organization that registered directly as a provider is already classified. The legacy `importer_exporter` company type remains readable for compatibility but is not offered as a provider onboarding category and never grants quoting/marketplace eligibility.
- **Employees inherit the organization’s classification, not additional authority.** A member invited into a provider organization sees provider routes only within that organization and only with the permissions of the assigned role.
- **Registration is not verification and is not a directory listing.** A provider may register, create an unverified profile and appear as a self-registered company; admin review remains a separate decision.
- **Backward compatibility.** Existing roles, memberships, sessions, companies and verification rows are unchanged. The migration only adds classification columns and backfills provider organizations that already own a non-`importer_exporter` company. A legacy token without classification continues to authenticate and is resolved from PostgreSQL on each request.

## Directory categories and evidence policy

Supported categories: Freight Forwarder, Shipping Line / Ocean Carrier, Shipping Agent, Road Carrier, Air Cargo Provider, Customs Broker, Warehouse / Storage Provider, Multimodal Logistics Provider. Legacy `carrier` remains readable.

Seeded international ocean carriers: Maersk, MSC, CMA CGM, Wan Hai Lines, Hapag-Lloyd, COSCO Shipping Lines, Evergreen Marine, ONE, Yang Ming, ZIM, Arkas Line.

These records are catalogued as **public directory candidates**, not verified NAQL AI accounts:

- official corporate website and source URL recorded;
- `verificationStatus=unverified`, `lastVerifiedAt=null`;
- no customer organization, no NAQL account, no login;
- no claim of an Egyptian office, Egyptian agent, port coverage, local capacity or live price;
- `pricingIntegrationStatus` and `availabilityIntegrationStatus` are `NOT_CONFIGURED`;
- no shipping line/local-agent relationship is asserted without evidence.

The public directory projection strips organization IDs, private contacts, verification documents and account authority. A directory record never grants portal access or private-RFQ eligibility.

## Marketplace design decision

The requested “marketplace” is implemented as an explicit RFQ-level `discoveryMode`:

- `invited` (default): only selected companies see the RFQ.
- `marketplace`: registered providers whose company mode can serve the RFQ see a **limited preview** and must explicitly join before receiving normal provider access.

The preview intentionally excludes:

- customer organization and creator identity;
- customer contact details;
- private documents;
- competing quotes;
- other providers and recipient lists.

Joining is idempotent, authorized against a company owned by the caller, audited, and limited to an open marketplace RFQ whose mode matches the provider. Joining does not grant access to any other RFQ and does not create an account or verification.

This design avoids the two unacceptable alternatives: publishing private RFQs to every provider, or claiming an automated external RFQ distribution network that does not exist.

## Threat and authorization review

| Route / capability | Control reviewed | Result |
|---|---|---|
| `GET /companies/directory` | public projection, consent, no org IDs/docs | Safe projection; contact only with consent |
| `GET /companies/:id` | same | Safe public projection |
| `POST /companies/register` | authenticated, caller organization only; provider type flips classification transactionally | Organization derived server-side; `importer_exporter` does not flip |
| Directory registration entry | no privilege from listing | No account/verification authority |
| `GET /auth/me`, `/auth/organizations` | current principal plus organization classification | Client-supplied classification is never trusted |
| `PATCH /company/account` | `company.settings.manage`; only `tradeRole` is writable | Cannot set account type, platform role or verification |
| `GET /rfqs` / `GET /rfqs/:id` | organization ownership, invited-provider projection | IDOR checks retained |
| `POST /rfqs` | customer role, recipient validation, dates/validation | Rejects invalid ownership/input |
| `POST /rfqs/:id/submit` | owner, draft-only transition | Drafts hidden from providers |
| `POST /rfqs/:id/cancel` | owner, accepted-state guard, transaction, reason | Rejects quotes and records history |
| `GET /rfqs/incoming` | company ownership, submitted-only, provider account guard | Customer org receives `provider_account_required`; drafts/cross-org RFQs absent |
| `GET /rfqs/opportunities` | provider account guard, registered provider, mode eligibility, limited view | No customer/docs/competitor data |
| `POST /rfqs/:id/join` | provider account guard, company ownership, eligibility, explicit opt-in | Idempotent and audited |
| `GET /rfqs/:id/activity` | owner/invited only, provider event filtering | No competitor quotes/customer user names to providers |
| `POST /rfqs/:id/quotes` | provider account guard, company ownership, open RFQ, source/currency rules | Rejects invalid/mixed/negative/unsourced |
| `POST .../quotes/:id/withdraw` | provider account guard, provider ownership, status guard | Existing controls retained |
| `GET /rfqs/:id/quotes/compare` | RFQ organization only | Cross-org denied; currencies not combined |
| `POST /rfqs/:id/accept` | customer ownership, valid quote, lock, one winner | Concurrency and retry tests pass |
| `GET/POST /rfqs/:id/documents` | owner upload, invited-provider read | Private docs hidden; storage keys stripped |
| `GET /rfqs/:id/documents/:documentId` | relationship + visibility check | 404 for unrelated/private access |
| Notifications | organization recipient, dedupe, generic body | No sensitive document/contact previews |

Additional controls: bounded pagination, Zod validation, artifact free-text limits, normalized file names, server-generated storage keys, `nosniff`/private-cache headers, audit events for submission/cancellation/join/upload, and transaction/advisory-lock use for cancellation and acceptance.

## Data-integrity review

- Unknown is not zero: unknown charges are explicit text and are not included in totals.
- Known subtotal and excluded/optional subtotal are shown separately.
- Quote components carry type, included/optional flags, source, confidence and optional source reference.
- A quote cannot mix currencies.
- Estimated/calculated prices cannot claim `confirmed`.
- Published-tariff quotes require a source reference/note.
- Comparison groups by currency; no FX conversion.
- The lowest total is explicitly not a recommendation; service differences are presented.
- Revision links are unique and retained.

## External integration audit

| Integration | State | Honest claim |
|---|---|---|
| Carrier/lineage pricing | `NOT_IMPLEMENTED` / `NOT_CONFIGURED` | No live rates |
| Carrier availability/capacity | `NOT_IMPLEMENTED` / `NOT_CONFIGURED` | No live availability |
| Carrier booking | `NOT_IMPLEMENTED` | Internal booking only; not an external confirmation |
| AIS/vessel/customs tracking | `NOT_IMPLEMENTED` | Live tracking returns unavailable |
| Email | `UNVERIFIED` / optional | Resend adapter exists; no real delivery verified here |
| WhatsApp/SMS/push | `NOT_IMPLEMENTED` | In-app only |
| OCR | `BLOCKED` (native Tesseract absent) | PDF text extraction only |
| ClamAV | `BLOCKED` (no clamd) | Status reported, not a clean guarantee |
| AI inference | `BLOCKED` (no credentials/model) | Deterministic fallbacks |
| Production object storage | `NOT_IMPLEMENTED` / local adapter | Not production S3 |
| Seeded carrier `lastVerifiedAt` | `null` | No independent verification review |

## Remaining blockers and non-goals

- Real third-party credentials, staging approval, production migration and restore drill.
- Legal/commercial verification of carrier agencies and port coverage.
- Dedicated carrier/airline/customs/warehouse portals (shared workspace only).
- Automated external distribution of RFQs.
- Ratings/reviews, invented prices or availability.
- Load/penetration testing beyond the covered authorization cases.

## Classification

Phase 5 is a coherent, test-backed marketplace subset with explicit customer/provider account separation. It is **not production-ready** and does not claim live integrations. Exact command results and test counts are in `docs/PHASE-5-TESTS.md`.
