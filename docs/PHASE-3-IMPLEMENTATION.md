# PHASE 3 IMPLEMENTATION — Secure Operations and Persistence

**Date:** 2026-10-21  
**Scope:** Booking/quotation integrity, secure documents, document processing, shipment events, persisted notifications, AI-provider honesty, and real frontend integration.  
**Compatibility:** Additive database migration and additive API fields. Existing Phase 1/2 records are preserved. No destructive reset was performed.

---

## 1. Database changes

Migration: `apps/api/prisma/migrations/20261021160000_phase3_operations/migration.sql`

All changes are additive. The migration:

- Adds `Notification` with user, organization, type, entity, read timestamp, dedupe key, delivery state, and timestamps.
- Adds `ShipmentEvent` with code, occurred/recorded time, source, actor, note, metadata, and a per-shipment idempotency key.
- Adds decision fields to `Quote`, `QuotationOffer`, and `BookingRequest`.
- Adds document security fields: SHA-256 hash, malware status/detail, retention timestamp, and soft-delete timestamp.
- Adds company-document ownership/hash/retention metadata.
- Adds a processing run/lease to `DocumentExtraction`.
- Adds unique indexes for:
  - one accepted quote per RFQ;
  - one awarded offer per quotation request;
  - one quote per company per RFQ (existing business rule);
  - idempotent notifications and shipment events.

The partial indexes enforce the winning-record invariants even if application code is bypassed. Application transactions still perform the same checks so callers receive clear errors.

No column was dropped, no table was truncated, and no production database was touched. Local `naql_ai` and `naql_ai_phase1_api` both report 6 migrations and “Database schema is up to date”.

---

## 2. Secure document storage

### 2.1 Trust boundary

The API never trusts a client-provided `organizationId` or `storageKey`.

- Tenant context comes from the authenticated principal and active membership.
- Shipment documents require `shipments.documents.read/upload` **and** `loadShipmentAccess`.
- Company verification documents require `company.documents.manage` and a company owned by the authenticated organization.
- Admin evidence downloads require platform staff permission `companies.documents.read` **and** a non-empty access reason.

### 2.2 Upload validation

`apps/api/src/documents/content.ts` and `storage-policy.ts` enforce:

- decoded size at most `MAX_DOCUMENT_BYTES` (default 2 MB);
- extension allow-list;
- declared MIME/content-type allow-list;
- magic-byte signature match (PDF, PNG, JPEG, plus supported text/CSV/JSON/XML);
- base64 decode errors and declared-size mismatch rejection;
- SHA-256 content hash;
- display filename sanitation (original name is metadata only);
- server-generated storage key using UUIDs and a validated extension;
- path traversal and absolute-path rejection.

The Fastify JSON body limit is 4 MB so a 2 MB decoded file fits after base64 and JSON overhead. Oversized requests are rejected before storage.

### 2.3 Storage

`apps/api/src/storage/adapter.ts` provides:

- local file storage with an explicit `STORAGE_PATH`;
- in-memory storage only for development when `STORAGE_PATH` is unset;
- a startup error in production when `STORAGE_PATH` is absent, so documents cannot silently disappear on restart;
- server-only object keys;
- storage failure responses return `503 storage_unavailable` with `stored: false`; no document row claims bytes that were not written.

The directory must be writable and outside `apps/web`. The application cannot guarantee the operator’s deployment path, so this is a setup requirement and production checklist item, not an automatable check.

S3-compatible storage is **not implemented**. Reserved S3 variables in `.env.example` are labelled as inactive.

### 2.4 Malware boundary

`apps/api/src/documents/malware.ts`:

- default `MALWARE_SCANNER=none` → every file is recorded as `not_scanned`;
- optional clamd INSTREAM adapter, configurable host/port/timeout;
- infected results reject the upload with `422 malware_detected` **before storing bytes**;
- a configured scanner that cannot answer fails closed with `503 malware_scan_unavailable` when `MALWARE_SCAN_FAIL_CLOSED=true`;
- scan details are persisted separately from the status;
- UI displays “not scanned” rather than implying a clean scan.

No ClamAV daemon was available during verification. The adapter exists, but real detection is unverified.

### 2.5 Download and confidentiality

Shipment documents:

- `GET /api/v1/documents/:id/content` requires bearer auth, `shipments.documents.read`, shipment access, and document visibility.
- A `private` document is visible only to the uploader organization and the shipment owner organization (subject to shipment permissions).
- `metadata_only`, soft-deleted, missing-byte, and infected documents cannot be downloaded.
- responses use safe attachment headers, `Cache-Control: private, no-store`, and `nosniff`.
- downloads produce `document.download` audit events.
- storage keys are never returned to the browser.

Company verification documents are available through company routes and staff routes. Staff access is logged with the reason.

### 2.6 Retention

`apps/api/src/documents/retention.ts` and `apps/api/scripts/documents-retention.ts`:

- default is a dry run;
- `--apply` is explicit;
- only documents past `retentionUntil` are selected;
- metadata is soft-deleted first, then bytes are removed;
- failures are reported without pretending deletion succeeded;
- `DOCUMENT_RETENTION_DAYS=0` and `COMPANY_DOCUMENT_RETENTION_DAYS=0` disable expiry.

---

## 3. Document processing and provenance

`apps/api/src/documents/processor.ts`:

- blocks `metadata_only`, missing-byte, infected, and soft-deleted documents;
- uses an application processing lease (`processingRunId`, `processingStartedAt`);
- recovers a stale lease;
- returns `processing` when another run owns the lease;
- upserts `DocumentExtraction` with run ID, method, OCR status, warnings, fields, and error details;
- stores failed/unavailable results so a previous success is not shown after a retry;
- is repeatable and idempotent for the same document content.

`apps/api/src/documents/extraction.ts`:

- deterministic text extraction for text-like types;
- calls the local Python AI service for PDF/image extraction with a timeout and abort;
- records provider status, attempts, latency, warnings, and error code;
- never invents text when the service is unavailable;
- falls back to deterministic field extraction only when text actually exists.

`apps/ai-service/main.py`:

- `pypdf` text extraction for structurally valid PDFs;
- explicit unsupported-content behavior (`status: unavailable`);
- malformed PDF rejection;
- optional `pypdfium2` rendering plus `pytesseract` OCR for scanned PDFs/images;
- `AI_OCR_ENABLED` defaults to false;
- OCR page limit `MAX_OCR_PAGES=5`;
- health reports `pdfText` and OCR capability honestly.

`apps/ai-service/test_main.py` covers valid PDF text, corrupt PDF, blank/scanned PDF without OCR, unavailable OCR, invalid base64, unsupported content, oversized content, and landed cost. Python dependencies are listed in `requirements.txt` and `requirements-dev.txt`.

---

## 4. Quotation and booking invariants

The following are enforced in `apps/api/src/rfq/routes.ts` and `apps/api/src/quotations/routes.ts`.

| # | Invariant | Implementation |
|---|---|---|
| 1 | RFQ belongs to the authenticated organization and user | RFQ queries include organization and owner checks; cross-tenant reads return 404. |
| 2 | Quote references a valid RFQ and invited company | Quote submission loads the RFQ and recipient by organization/company; invalid or closed RFQs are rejected. |
| 3 | Expired/withdrawn/rejected quotes cannot win | Acceptance checks status, `validityUntil`, `withdrawnAt`, and rejection state inside the transaction. |
| 4 | Currency and money are consistent | ISO-4217-shaped uppercase currency; line currencies must match; positive quantities/prices; total is computed from included items. |
| 5 | Single acceptance | Partial unique index on accepted quote per RFQ plus transactional checks; concurrent loser gets `409 already_accepted`. |
| 6 | One winning offer per RFQ | Partial unique index on awarded offer; award is transactional. |
| 7 | Accept + booking in one transaction | Prisma transaction plus PostgreSQL advisory lock; notification is sent only after commit. |
| 8 | Booking references winning quote (and shipment when supplied) | `BookingRequest.quoteId` is required and unique; optional `shipmentId` is validated for ownership/status before use. Standalone RFQs have no shipment column, so the link exists only when the client supplies a shipment. |
| 9 | Retry-safe | Repeating the same acceptance returns `200` with `alreadyAccepted: true` and the existing booking. Withdrawal repeats return `alreadyWithdrawn: true`. |
| 10 | Concurrency-safe | Advisory lock serializes acceptance per RFQ; unique constraints are the final guard. |
| 11 | Rejections/cancellations record reason, actor, time | Quote decisions store status, `decidedAt`, `decidedByUserId`, and reason fields. Booking reject/cancel require a reason and store actor/time. |
| 12 | Explicit state machine | Quote statuses and booking statuses are validated before transitions. Withdrawal is provider-only and blocked after acceptance. |

Losing quotes are rejected in the same acceptance transaction where feasible, and notifications are emitted after commit. A failed notification does not roll back an already-committed booking.

### Withdrawal

New endpoint: `POST /api/v1/rfqs/:id/quotes/:quoteId/withdraw`

- only the owning provider organization with `quotes.submit`;
- rejected after acceptance;
- idempotent for an already-withdrawn quote;
- records `withdrawnAt`, actor, reason;
- creates `QUOTATION_WITHDRAWN` notifications;
- a withdrawn quote cannot be accepted.

### Known limitation

A withdrawn quote cannot currently be re-submitted for the same company/RFQ because the existing unique constraint still reserves that tuple. The API reports the conflict rather than creating a duplicate. This is documented in `IMPLEMENTATION_STATUS.md`.

---

## 5. Shipment events and tracking

`apps/api/src/shipments/state.ts` defines:

- allowed event codes;
- allowed shipment status transitions;
- event-to-status effects.

`apps/api/src/shipments/events.ts`:

- `GET /api/v1/shipments/:id/events` returns chronological events with actor, source, and timestamps;
- `POST /api/v1/shipments/:id/events` validates code, `occurredAt` (not in the future by an unreasonable margin), note length, metadata shape, and transition;
- supports `manual`, `imported`, and `external_verified` sources;
- **`imported` and `external_verified` are rejected with `503 live_tracking_integration_unavailable`** until a real integration exists;
- manual events require `shipments.events.manage` and shipment party permission;
- per-shipment idempotency key prevents duplicate milestones;
- creates persisted `SHIPMENT_MILESTONE` notifications;
- a repeated event returns the existing event rather than duplicating it.

`GET /api/v1/shipments/:id/tracking` returns `liveTracking.available=false` with `live_tracking_unavailable`. No GPS, carrier, vessel, customs, or ETA data is fabricated.

---

## 6. Notifications

`apps/api/src/notifications/service.ts` and `routes.ts`:

- persist notifications per user **and** organization;
- deduplicate by scope/dedupe key;
- record type, title, body, entity, metadata, read time, external delivery state, and timestamps;
- support pagination and unread count;
- mark one/all read;
- retry external delivery only when a provider is configured;
- clearly distinguish “persisted in your workspace” from “sent by email/WhatsApp”.

Event coverage:

| Event | Type |
|---|---|
| Quote received | `QUOTATION_RECEIVED` |
| Quote accepted | `QUOTATION_ACCEPTED` |
| Quote rejected / losing offer | `QUOTATION_REJECTED` |
| Quote withdrawn | `QUOTATION_WITHDRAWN` |
| Booking confirmed | `BOOKING_CONFIRMED` |
| Booking rejected | `BOOKING_REJECTED` (with reason) |
| Booking cancelled | `BOOKING_CANCELLED` (with reason) |
| Shipment milestone | `SHIPMENT_MILESTONE` |
| Severe consistency findings / missing documents | `DOCUMENT_FINDINGS` |
| High/critical risk refresh | `RISK_ALERT` |

External delivery providers are not implemented. The UI and API say so explicitly; no notification is marked delivered without a provider response.

---

## 7. AI behavior

- Default `AI_PROVIDER=none`.
- Copilot returns a deterministic degraded answer and `providerAvailable=false`.
- Risk and consistency remain deterministic and independent of AI availability.
- No API key is exposed to the browser or logs.
- The Python document extractor is separate from the conversational provider.
- Real OpenAI/OpenAI-compatible/Ollama behavior was not tested because no credentials/model were configured.
- Cost/config documentation is in `.env.example` and `docs/PHASE-3-SETUP.md`.

---

## 8. Frontend integration

Arabic RTL layout and existing design tokens were preserved.

- `apps/web/lib/api.ts`: authenticated JSON requests and binary `apiDownload`/`downloadFile`.
- Documents page: secure upload, scan/processing badges, download, extraction, consistency, honest unavailable messages.
- Company registration: verification document upload/list/download.
- Notifications page: pagination, unread count, read/read-all, retry, external-delivery disclosure.
- App shell: notifications navigation and unread badge.
- Shipment detail: milestone timeline, source labels, manual event form, live-tracking unavailable notice.
- Bookings: reason-required reject/cancel, event selection, retry with a stable idempotency key.
- RFQ detail: quote comparison and acceptance.
- Provider RFQ detail: quote withdrawal.
- No hardcoded success or fabricated shipment/notification data.

Build and typechecking pass. A real browser smoke exercised registration, notifications, a text document upload, processing, extraction display, and authenticated download. Full quote/booking browser flow is not automated.

---

## 9. Tests added or updated

- `apps/api/src/__tests__/phase3-operations.test.ts` — 7 tests:
  1. company verification upload/list/download and storage-key secrecy;
  2. shipment document authorization and cross-org download denial;
  3. concurrent quote acceptance, retry safety, booking decisions;
  4. expired quote rejection;
  5. provider-only quote withdrawal and acceptance blocking;
  6. shipment milestone idempotency, transitions, live-tracking boundary;
  7. retention dry-run and apply behavior.
- `apps/api/src/__tests__/postgres-persistence.test.ts` updated to use a validated event code.
- `apps/api/src/documents/__tests__/extraction.test.ts` covers extraction behavior.
- `apps/api/src/__tests__/storage.test.ts` covers key generation and traversal.
- `apps/api/src/__tests__/access-separation.test.ts` and admin tests continue to cover tenant and platform boundaries.
- `apps/ai-service/test_main.py` — 6 tests for extraction/OCR/capability honesty.

Test counts are recorded in `IMPLEMENTATION_STATUS.md` and are based on the final actual run, not estimates.

---

## 10. Compatibility and limitations

- Existing metadata-only document upload remains accepted for legacy clients; those rows cannot be processed or downloaded.
- `POST /api/v1/shipments/:id/tracking` validates the event code now. Legacy callers using arbitrary codes must migrate to the documented codes.
- Quote withdrawal is a new endpoint; no previous API was removed.
- A withdrawn quote cannot be resubmitted for the same company/RFQ.
- Booking–shipment linkage is optional because RFQs are not tied to a shipment in the data model.
- Local storage is the only verified storage backend.
- Malware scanning, OCR, live tracking, external notification delivery, real AI providers, S3, and automated browser E2E remain blocked or unverified as documented.
- No commit, push, deployment, production migration, or credential rotation was performed.
