# PHASE 3 AUDIT — Production Readiness for Operations, Documents, and Notifications

**Audit date:** 2026-10-21  
**Repository:** `E:\naql ai`  
**Branch / HEAD:** `main` at `84f11c2`  
**Working tree:** Phase 1–3 changes are uncommitted. No commit, push, deploy, production migration, or credential rotation was performed.

---

## 1. Baseline before Phase 3

Phase 1 and Phase 2 were already implemented and verified:

- PostgreSQL API suite: **131/131 passing across 15 files**.
- No-database fallback: **90 passed, 41 skipped**.
- API typecheck and build: passing.
- Web typecheck and production build: passing.
- Prisma validate and local migrate status: passing at 5 migrations.
- Phase 2 had a real document pipeline, consistency engine, deterministic risk/delay, no-provider AI gateway, and a Python extraction service.
- The existing repository still allowed insecure document metadata, arbitrary tracking codes, no persistent notifications, and no atomic quote acceptance.

The audit inspected the actual schema, migrations, routes, storage adapter, extraction code, tests, frontend pages, and Git diff. Documentation was not treated as proof of functionality.

---

## 2. Findings at the start of Phase 3

| Area | Initial state | Evidence / risk |
|---|---|---|
| Company verification document upload | Broken / unsafe | The old path returned `503 secure_document_upload_unavailable`; there was no authenticated org-scoped byte upload. |
| Shipment document storage | Partial | Metadata upload existed; retrieval bytes, malware status, hashes, retention, and quarantine behavior were absent. A client-supplied `storageKey` was accepted by the old upload contract. |
| Document validation | Partial | MIME and size checks existed; malware scanning, SHA-256, server key generation, and strict download authorization were missing. |
| Document processing | Implemented in Phase 2 | Text/PDF extraction existed but PDF support was unverified because `pypdf` was not installed. No processing lease/idempotency. |
| OCR | Unavailable | No native Tesseract executable; the service reported OCR honestly but no end-to-end PDF OCR path had been exercised. |
| Quote acceptance | Unsafe under concurrency | Application checks could race; there was no atomic accept-and-book transaction, no advisory lock, and no partial unique index. |
| Quote validity | Partial | Expiry was not consistently rejected. Withdrawn quotes had no endpoint. |
| Money / currency | Partial | Line-item currency consistency and positive totals were not enforced uniformly. |
| Booking decision audit | Partial | Rejection and cancellation reasons, actor, and timestamp were not guaranteed or exposed consistently. |
| Booking ↔ shipment | Partial | A booking always references its quote; the shipment link was optional and unvalidated in the old route. |
| Shipment tracking | Unsafe / invented values possible | Arbitrary event codes and future timestamps were accepted; no shared state machine or idempotency. |
| External tracking | Not implemented | No carrier, AIS, port, or customs integration exists. The product had no explicit unavailable response contract. |
| Notifications | Not implemented | No persistence, read state, pagination, deduplication, or delivery boundary. |
| AI provider | Honest no-provider mode | `AI_PROVIDER=none` and deterministic fallback existed; no real provider credentials were available to validate. |
| Frontend | Partial / inconsistent | Documents UI had no authenticated download. Quote comparison was thin. Booking tracking used free-text codes. No notification page or shipment event timeline. |
| Browser E2E | Not established | No Playwright/Cypress suite existed. |

---

## 3. Blocking conditions and how they were treated

| Blocker | Treatment in this phase |
|---|---|
| No ClamAV daemon | Added a replaceable adapter and `not_scanned` default. A configured scanner fails closed. Real infection detection is **not verified**. |
| No production object storage credentials | Local secure storage is verified. S3 remains reserved and unimplemented; production object storage is **BLOCKED**. |
| No native Tesseract | PDF text extraction is verified. OCR code paths report `OCR_UNAVAILABLE`; real OCR is **BLOCKED**. |
| No AI provider credentials | `AI_PROVIDER=none` and deterministic behavior are verified. Real model output/cost is **BLOCKED**. |
| No external email/WhatsApp provider | Notifications are persisted in-app. External delivery is explicitly unavailable; adapters are not claimed as delivered. |
| No carrier/AIS/customs feed | Live tracking returns `503` for imported/external events and `liveTracking.available=false`. No GPS, vessel, ETA, or customs data is fabricated. |
| No automated browser E2E harness | A manual browser smoke was run. Automated E2E remains **NOT_IMPLEMENTED**. |
| No production backup/staging drill approval | Not performed. Local backup/restore from Phase 2 remains separate from this phase. |

---

## 4. Implementation sequence used

1. Inspect schema, routes, storage, extraction, tests, and frontend.
2. Add additive Phase 3 schema and migration (no reset, no destructive change).
3. Add secure document policy, malware adapter, hashes, retention, and download routes.
4. Harden company verification document upload.
5. Make document processing idempotent with a lease and persisted status.
6. Add PDF text verification and explicit OCR capability reporting.
7. Harden quote submission, withdrawal, acceptance, and booking decisions.
8. Add partial unique indexes and advisory-lock transactions.
9. Add shipment event state machine, idempotency, timeline API, and live-tracking boundary.
10. Add persistent notifications, read state, deduplication, and delivery boundary.
11. Integrate real APIs into the existing Arabic RTL frontend.
12. Run database, no-database, Python, typecheck, build, Prisma, and browser checks.
13. Record honest status and remaining blockers.

---

## 5. Post-implementation classification

| Requirement | Classification | Notes |
|---|---|---|
| Authenticated, org-authorized company document upload | `IMPLEMENTED_AND_TESTED` | Real PDF/PNG/JPEG bytes, server keys, SHA-256, audit, cross-org denial. |
| Authenticated, org-authorized document download | `IMPLEMENTED_AND_TESTED` | Bearer-auth content route, shipment-party checks, `private` visibility, safe headers, audit. |
| Strict size/extension/MIME/signature checks | `IMPLEMENTED_AND_TESTED` | 2 MB decoded limit, PDF/PNG/JPEG signatures, traversal rejection, legacy test updated. |
| Malware scanning adapter | `IMPLEMENTED_BUT_UNVERIFIED` | `not_scanned` and fail-closed paths exist; no clamd daemon was available. |
| Retention and deletion policy | `IMPLEMENTED_AND_TESTED` | Dry-run default, explicit `--apply`, soft delete then bytes removal. |
| PDF text extraction | `IMPLEMENTED_AND_TESTED` | `pypdf==5.1.0` installed; real structurally valid PDF extracted in Python tests. |
| Scanned PDF/image OCR | `BLOCKED` | Native Tesseract unavailable; `OCR_UNAVAILABLE` is returned honestly. |
| Quotation/booking invariants | `IMPLEMENTED_AND_TESTED` | Atomic acceptance, partial unique indexes, expiry/withdrawal, concurrency and retry tests. |
| Booking-shipment linkage | `PARTIALLY_IMPLEMENTED` | Booking always references the accepted quote. A shipment link is validated when supplied; RFQ itself has no shipment column, so standalone RFQs produce a booking without a shipment reference. |
| Manual shipment timeline | `IMPLEMENTED_AND_TESTED` | Validated event codes, timestamps, actors, source, idempotency, transitions, notifications. |
| Live/external tracking | `BLOCKED` | Explicit unavailable response; no integration. |
| Persistent notifications | `IMPLEMENTED_AND_TESTED` | DB rows, user/org scoping, unread/read, pagination, dedupe. |
| External email/WhatsApp delivery | `BLOCKED` | No provider configured; persisted-vs-delivered distinction is explicit. |
| `AI_PROVIDER=none` / deterministic behavior | `IMPLEMENTED_AND_TESTED` | No model call; deterministic fallbacks preserved. |
| Real AI provider | `BLOCKED` | No credentials/model configured or evaluated. |
| Frontend API integration | `IMPLEMENTED_AND_TESTED` (documents path) / `IMPLEMENTED_BUT_UNVERIFIED` (full quote-booking browser flow) | Notifications and document upload/process/download were exercised in a real browser. Quote/booking pages compile and use real APIs but lack an automated browser suite. |
| Automated browser E2E | `NOT_IMPLEMENTED` | Manual smoke only. |
| Production object storage | `BLOCKED` | S3-compatible adapter not implemented; local storage is the verified mode. |
| Production migration / deploy | `NOT_PERFORMED` | Only local dev/test databases received migrations. |

---

## 6. Acceptance criteria

| Criterion | Result |
|---|---|
| Client cannot choose an arbitrary storage key or path | Pass |
| Upload requires auth, company permission, and shipment access | Pass |
| Cross-organization document download is denied | Pass |
| Bytes are read through the API, not a public URL | Pass |
| Size/MIME/extension/signature mismatch rejected | Pass |
| Malware status is never fabricated as clean | Pass (`not_scanned` default) |
| Retention is dry-run by default | Pass |
| Quote cannot be accepted after expiry or withdrawal | Pass |
| Exactly one quote is accepted under concurrent requests | Pass |
| Accept + booking are one transaction | Pass |
| Retry of the same acceptance is safe | Pass |
| Rejected quotes record actor/reason/time | Pass |
| Booking confirm/reject/cancel require valid actors and reasons | Pass |
| Shipment event codes and timestamps are validated | Pass |
| External/imported events are rejected without an integration | Pass |
| Notifications are user/org scoped and paginated | Pass |
| Notifications are not claimed as externally delivered | Pass |
| AI no-provider mode does not invent an answer | Pass |
| Local storage outside the web root can be configured | Pass (operator responsibility) |
| Real malware detection | Not verified |
| Real OCR | Blocked |
| Real AI provider | Blocked |
| Live tracking | Blocked |
| Production S3 storage | Blocked |
| Automated browser E2E | Not implemented |

---

## 7. Verification commands and results

Final commands are recorded in `docs/PHASE-3-SETUP.md` and the root `IMPLEMENTATION_STATUS.md`. The database suite was run against the dedicated test database `naql_ai_phase1_api`; the development database `naql_ai` was only inspected/migrated locally. No production database was touched.

Verification includes:

- `pnpm --filter @naql/api typecheck`
- `pnpm --filter @naql/api build`
- `pnpm --filter @naql/api exec vitest run` with `DATABASE_URL` pointing at the test DB
- The same suite with `NAQL_DISABLE_ENV_FILE=1` and no database variables
- `python -m pytest apps/ai-service/test_main.py -q`
- `pnpm --filter @naql/web typecheck`
- `pnpm --filter @naql/web build`
- `prisma validate` and `prisma migrate status` for both local DBs
- A manual browser smoke of registration, notifications, secure text-document upload, processing, extraction display, and authenticated download

The audit does not treat skipped tests, unavailable external services, or manual smoke as substitutes for automated coverage.
