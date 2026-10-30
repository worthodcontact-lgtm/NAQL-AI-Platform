# PHASE 2 IMPLEMENTATION — Intelligence Engine & Document AI

**Implementation date:** 2026-10-21  
**Repository:** `E:\naql ai`  
**Branch:** `main` at `84f11c2` plus uncommitted Phase 1 and Phase 2 work  
**Production changes:** none. No commit, push, deploy, production migration, credential rotation, or production database access was performed.

---

## 1. Executive summary

Phase 2 adds a working document-processing and logistics-intelligence layer without pretending that an LLM, OCR engine, malware scanner, live logistics feed, or trained prediction model exists.

What now works end to end:

1. A shipment document can be uploaded after MIME type, extension, declared size and content-signature checks.
2. The stored bytes are read back through the storage abstraction and processed synchronously.
3. Text documents are classified and parsed by a deterministic extractor with per-field provenance.
4. The result is persisted as a `DocumentExtraction` with OCR/malware status, fields, warnings and method.
5. The deterministic consistency engine compares documents and the shipment record and persists `DocumentFinding` rows with stable codes and severities.
6. The Copilot builds context only from the authenticated principal and authorized shipment rows, returns source references, persists conversations, and falls back to an explicit deterministic summary when no provider is configured.
7. Risk and delay endpoints derive transparent indicators from recorded data. Delay days remain `null` when there is no planned ETA; the system does not invent a number.
8. The Next.js UI exposes processing, extraction review, consistency findings, Copilot sources, and risk/delay limitations in Arabic RTL.

Phase 2 is **not** a production ML or RAG platform. The retrieval adapter is deterministic keyword retrieval, not semantic/vector search. No trained model was created or evaluated.

---

## 2. Database schema and migration

Migration: `apps/api/prisma/migrations/20261021120000_phase2_intelligence/migration.sql`

The migration is additive:

- `Document.contentType` — nullable declared MIME type.
- `Document.size` — nullable byte size.

New tables:

| Table | Purpose |
|---|---|
| `DocumentExtraction` | Current processing result per document: status, type, method, OCR/malware status, provider/model, bounded text, structured fields, warnings, error. |
| `DocumentFinding` | Deterministic consistency finding with code, severity, observed/expected values, explanation, corrective action, review flag and source documents. |
| `AiExecution` | Provider metadata only: operation, provider, model, status, latency, token usage, cost, error code. No prompts, document text or model output. |
| `CopilotConversation` | Organization/user-owned conversation header. |
| `CopilotMessage` | User/assistant message, status, source references, suggested actions and warnings. |
| `ShipmentRiskAssessment` | Persisted risk score, category, method, rule version, completeness, factors and recommendations. |
| `ShipmentDelayEstimate` | Persisted delay status, nullable day estimates, category, method, factors and recommendations. |

`DocumentExtraction` is one row per document (`documentId @unique`). Historical assessments are retained; document findings are replaced per actor organization when consistency is recomputed.

### Migration safety

- Applied only to local databases: `naql_ai_phase1_api` and `naql_ai`.
- No destructive statements, no column drops, no data reset and no production URL.
- Existing `Document.validation` was retained as a legacy field. New code writes a small JSON summary there for compatibility, while structured data is stored in `DocumentExtraction` and `DocumentFinding`.

### Backup coverage

`apps/api/scripts/db-tables.ts` now includes **31 tables**, including all seven Phase 2 tables. The table-list consistency test passes.

A local backup/restore drill containing Phase 2 rows **was** performed:

- Backup source: local `naql_ai_phase1_api`.
- Target: disposable local `naql_ai_phase2_restore_20261021`, migrated with all five migrations.
- Backup included all 31 tables and **2,131 rows**.
- Phase 2 rows included 11 `documentExtraction`, 8 `documentFinding`, 11 `copilotConversation`, 22 `copilotMessage`, 6 `shipmentRiskAssessment` and 6 `shipmentDelayEstimate`.
- Restore inserted every row and verified per-table counts before commit.
- The disposable database and temporary backup file were removed afterwards.

Production backup/restore assurance is still not claimed; that requires an approved production drill.

---

## 3. AI gateway

File: `apps/api/src/ai/gateway.ts`

Supported modes:

- `AI_PROVIDER=none` — default. Returns `status: "unavailable"` and `errorCode: ai_provider_not_configured`. Deterministic features continue to work.
- `openai` — OpenAI-compatible chat completions at `https://api.openai.com/v1`.
- `openai-compatible` — same adapter with a required/configurable `AI_BASE_URL`.
- `ollama` — `/api/chat` at `AI_BASE_URL` or `http://127.0.0.1:11434`; no API key required.

Implemented behavior:

- Configurable model, base URL, API key, timeout and bounded retries (`AI_MAX_RETRIES`, clamped 0–3).
- Retries on HTTP 408, 429, 5xx and network/timeout failures; no retry on ordinary 4xx responses.
- Normalized results: `completed | unavailable | timeout | failure | validation_failed`.
- JSON output is parsed and validated with the caller's Zod schema.
- Provider failures are separated from business validation failures in the response and from persisted `AiExecution` metadata.
- `AiExecution` stores metadata only. `redactForLog()` removes authorization, API-key, secret, token, prompt and content fields from diagnostic structures.
- Provider credentials are read server-side only and never returned by `/api/v1/ai/status`.

Tested with mocked providers: no-provider mode, success parsing, schema rejection, retry, timeout, redaction.

**Not verified:** a real paid provider call. No key or external provider was configured or used.

---

## 4. Document processing pipeline

### 4.1 Upload validation

Files:

- `apps/api/src/documents/content.ts`
- `apps/api/src/documents/routes.ts`
- `apps/api/src/storage/adapter.ts`

Controls:

- Allowed MIME types only: PDF, PNG, JPEG, CSV, JSON, XML, plain text.
- Filename extension must match the declared MIME type.
- Content signature must match the declared type:
  - PDF must contain `%PDF-` in the first 1 KB.
  - PNG and JPEG magic bytes are checked.
  - Text formats must be plausible UTF-8 text without NUL/control-byte payloads.
  - JSON/XML must start with the corresponding structure.
- SVG and HTML are not accepted.
- Maximum 2 MB.
- Base64 payload syntax is checked and decoded size must match the declared size.
- Storage keys remain server-generated; original filenames are display-only.
- If no file payload is supplied, the row is stored as `metadata_only`; processing later fails explicitly with `document_bytes_unavailable` instead of pretending the file was processed.

### 4.2 Text/PDF/OCR extraction

File: `apps/api/src/documents/extraction.ts`

- Text, CSV, JSON, XML and plain text are decoded directly in TypeScript.
- PDF text and image OCR are delegated to the optional Python service at `POST /documents/extract`.
- The Python service reports its capabilities honestly at `/health`:
  - `pdfText` is false when `pypdf` is not installed.
  - `ocr` is false when `pytesseract` or Pillow is not installed.
- Scanned PDFs without a text layer return `OCR_UNAVAILABLE`; no OCR is claimed.
- If the Python service is unreachable, the API returns `status: "unavailable"` with `EXTRACTION_UNAVAILABLE`.
- Malware scanning is **not implemented**. Every extraction stores `malwareScanStatus: "not_scanned"` and includes a warning. No scan is claimed.

Current local environment:

- Python 3.12.6.
- FastAPI service imports and starts.
- `pypdf` is **not installed**, so PDF text capability is false.
- `pytesseract` is **not installed** and the tesseract executable is not configured, so OCR capability is false.
- `/health` and text extraction through the Python service were exercised successfully.

### 4.3 Classification and field extraction

Deterministic version: `deterministic-text-v1`.

Supported document types:

`commercial_invoice`, `packing_list`, `bill_of_lading`, `certificate_of_origin`, `shipping_instructions`, `customs_document`, `other`.

Fields include invoice/BL/document number, issue date, parties, shipment reference, container numbers, vessel/voyage, ports, origin country, HS codes, description, package count/type, gross/net weight, volume, currency, subtotal/tax/total, unit price and Incoterm.

Behavior:

- English and Arabic headings are recognized for classification.
- Field values include method and source location (`text line N`).
- Deterministic fields do **not** receive an invented confidence score.
- Required-field checks add explicit `missing` fields and warnings instead of guessing.
- Malformed dates and numbers are marked `invalid`.
- An optional AI provider may enrich fields. Provider values are marked `unverified`; deterministic values remain when the provider omits them.
- Provider output is schema-validated before use.

### 4.4 Persistence

File: `apps/api/src/documents/processor.ts`

- `DocumentExtraction` is upserted with `status: processing` before I/O.
- Completed results persist type, method, provider/model, OCR status, malware status, bounded text (50,000 characters), fields, warnings and timestamps.
- Failed/unavailable results persist explicit error codes and clear stale extracted text.
- `Document.status` becomes `processed`, `processing_unavailable` or `processing_failed`.
- The API never returns `storageKey` or full extracted text in document views.

### 4.5 API endpoints

- `POST /api/v1/documents/:id/process`
- `POST /api/v1/documents/:id/validate` (backward-compatible alias; now real processing)
- `GET /api/v1/documents/:id/extraction`

See `docs/PHASE-2-API.md`.

---

## 5. Deterministic consistency engine

File: `apps/api/src/intelligence/consistency.ts`  
Rule version: `2026-10-21.1`

Severities: `INFO`, `WARNING`, `ERROR`, `CRITICAL`.

Implemented rules include:

| Code | Meaning |
|---|---|
| `DOCUMENT_NOT_PROCESSED` | Document has no extraction. |
| `EXTRACTION_UNAVAILABLE` | No text/OCR was available. |
| `PROCESSING_FAILED` | Processing failed. |
| `INVALID_FIELD_VALUE` | Extracted value is malformed. |
| `REQUIRED_FIELD_MISSING` | Required field for the document type is absent. |
| `SHIPMENT_REFERENCE_MISMATCH` | Document reference differs from the shipment. |
| `FUTURE_DOCUMENT_DATE` | Issue date is in the future. |
| `HS_CODE_INVALID` | HS code is not 6, 8 or 10 digits. |
| `TOTAL_RECONCILIATION_MISMATCH` | Invoice total does not equal subtotal + tax. |
| `INVOICE_CURRENCY_MISMATCH` | Invoice currency differs from recorded quotation currency. |
| `GROSS_WEIGHT_MISMATCH` | Gross weight differs between documents beyond tolerance. |
| `SHIPMENT_WEIGHT_MISMATCH` | Document weight differs from the shipment record beyond tolerance. |
| `PACKAGE_COUNT_MISMATCH` | Package counts differ between documents. |
| `CONTAINER_NUMBER_MISMATCH` | Container sets differ between documents. |
| `PORT_MAY_MISMATCH` | Document port could not be matched to the route. |
| `DUPLICATE_DOCUMENT_NUMBER` | Same document number appears more than once. |

Tolerances:

- Weight: 2% relative or 0.5 kg absolute, whichever is larger.
- Money: 0.01.

Every finding includes the primary document, optional extraction, observed/expected values, explanation, suggested action, `requiresReview`, and source document IDs. Findings are review prompts, not customs or legal determinations.

Persistence API:

- `POST /api/v1/shipments/:id/consistency`
- `GET /api/v1/shipments/:id/consistency`
- `POST /api/v1/documents/consistency/:shipmentId` (compatibility alias)

Tested with matching documents, missing/invalid fields, weight/package/container conflicts, total/currency conflicts, reference/port conflicts and tolerance boundaries.

---

## 6. Authorized Copilot and retrieval

Files:

- `apps/api/src/ai/retrieval.ts`
- `apps/api/src/ai/copilot.ts`
- `apps/api/src/ai/routes.ts`

### Authorization

- Context is derived only from `getAuthUser(request)`.
- No `organizationId` is accepted from the client.
- Shipment-specific retrieval calls `loadShipmentAccess` and requires `view`.
- Document chunks are filtered by owner status, `canViewDocuments`, document `visibility` and uploader organization.
- Financial quotation chunks require owner status or `canViewFinancials`.
- Global retrieval starts from `visibleShipmentWhere(user)`, then re-checks each candidate with `loadShipmentAccess`.
- Conversation reads require matching `organizationId` and `userId`.

Tests cover a rival organization attempting shipment-specific retrieval, global retrieval, Copilot and extraction access. All return no cross-tenant records.

### Retrieval method

`deterministic-keyword-v1`:

- Keyword token overlap over authorized shipment, milestone, document, finding and quotation chunks.
- Bounded chunks (maximum 40) and context size (24,000 characters).
- Source references are returned with each answer.
- This is **not** vector or semantic search. No embedding model or pgvector index exists.

### Prompt-injection handling

- Retrieved document text is explicitly delimited as untrusted data in the provider prompt.
- The system prompt forbids following document instructions, calling tools, or revealing system prompts.
- Document text and prompts are not stored in AI execution logs.
- Adversarial prompt-injection test coverage is not exhaustive; the control is implemented but unverified against a broad attack corpus.

### No-provider behavior

When `AI_PROVIDER=none`:

- Response status is `degraded`.
- A deterministic summary is produced from authorized retrieval.
- Sources, suggested actions and warnings are returned.
- No confidence score is fabricated.
- Conversations are still persisted when a database is available.

When a provider is configured but fails:

- The response falls back to the deterministic summary and `degraded` status.
- Provider failure metadata is recorded in `AiExecution`.

Endpoints:

- `POST /api/v1/ai/copilot`
- `GET /api/v1/ai/conversations/:id`
- `POST /api/v1/ai/retrieval/search`
- `GET /api/v1/ai/status`

---

## 7. Risk and delay

File: `apps/api/src/intelligence/risk.ts`  
Rule versions: `risk-v1-2026-10-21`, `delay-v1-2026-10-21`

### Risk

Deterministic score 0–100 with category `low | medium | high | critical`.

Factors include:

- Missing required documents for the shipment status.
- Documents without completed extraction.
- Consistency findings weighted by severity.
- Shipment exception status.
- Missing departure/arrival/delivery milestones.
- Incomplete route.
- Missing cargo weight.

Output includes score, category, method, rule version, data completeness, factors with weights/evidence, and recommendations. It is an operational indicator, not a trained model.

### Delay

The current schema has **no planned ETA field**. Therefore:

- If departure and arrival/delivery milestones are both recorded, the response reports `status: "observed"` and the observed transit duration. It does **not** call that a delay.
- Otherwise the response is `status: "insufficient_data"`, `estimatedDelayDays`, `minDelayDays` and `maxDelayDays` are `null`, and recommendations say that an ETA is required.
- No ML training, evaluation or claimed accuracy exists.

Endpoints:

- `GET /api/v1/shipments/:id/intelligence`
- `POST /api/v1/shipments/:id/intelligence/refresh`
- `GET /api/v1/shipments/:id/intelligence/history`
- `POST /api/v1/ai/predict-delay` (requires `shipmentId`; legacy free-text route input is rejected with `shipment_required`)

Assessments are persisted per shipment and organization.

---

## 8. Frontend integration

Files:

- `apps/web/app/(app)/documents/page.tsx`
- `apps/web/app/(app)/ai/page.tsx`
- `apps/web/app/(app)/shipments/[id]/page.tsx`

Implemented:

- Arabic RTL copy aligned with the existing interface.
- Document upload uses a real API call and shows content-validation errors.
- “معالجة المستند” calls `POST /documents/:id/process`; no `alert()` mock.
- Extracted fields table shows value, method/source and validation status.
- OCR/malware status is visible; malware is shown as `not_scanned`.
- Consistency check calls the real shipment endpoint and displays severity, code, message and suggested action.
- Copilot shows provider availability, deterministic/degraded status, source list, suggested actions and warnings.
- Shipment detail shows risk score, category, completeness, factors, recommendations, delay status and explicit limitations.
- Loading, empty, unavailable, degraded and error states are present.

Verification: web typecheck and production build pass. No browser E2E suite was run.

---

## 9. Verification record

Commands actually executed and results:

| Check | Result |
|---|---|
| `pnpm --filter @naql/api test` against `naql_ai_phase1_api` | **131/131 tests passed across 15 files** |
| Same suite with `NAQL_DISABLE_ENV_FILE=1` and empty `DATABASE_URL` | **90 passed, 41 skipped**, 11 files passed, 4 skipped |
| `pnpm --filter @naql/api typecheck` | pass (build and test TypeScript configs) |
| `pnpm --filter @naql/web typecheck` | pass |
| `pnpm --filter @naql/web build` | pass, **43 routes** |
| `prisma validate` | pass |
| `prisma migrate deploy` on local test and dev DB | pass |
| `prisma migrate status` on test DB | pass; 5 migrations, schema up to date |
| Local backup/restore drill with Phase 2 rows | pass; 31 tables, 2,131 rows, counts verified |
| `python -m py_compile apps/ai-service/main.py` | pass |
| Python service `/health` and text `/documents/extract` | pass; `pdfText=false`, `ocr=false` reported honestly |

Local databases used:

- `naql_ai_phase1_api` — API test database.
- `naql_ai` — local development database.

No production database was read, migrated, modified or restored.

---

## 10. Feature classification

### Implemented and tested

- Secure upload content-signature and extension/MIME validation.
- Storage read-back for server-side processing.
- Plain-text/CSV/JSON/XML extraction.
- Deterministic document classification and field extraction.
- Missing/invalid field reporting with provenance.
- Extraction persistence and document status updates.
- Deterministic consistency rules and tolerance behavior.
- Finding persistence and retrieval.
- AI gateway no-provider mode, retry, timeout, schema validation and redaction (mocked provider).
- Authorized shipment-specific and global retrieval isolation.
- Copilot authorization, deterministic fallback, source references and conversation persistence.
- Risk scoring, factors, data completeness and persisted history.
- Delay insufficient-data and observed-transit behavior.
- Local backup/restore of all 31 tables, including Phase 2 rows.
- Phase 1 regression suite.

### Implemented but unverified

- Real OpenAI/OpenAI-compatible/Ollama provider call.
- Provider-enriched document extraction against a real model.
- PDF text extraction (code and service capability exist; `pypdf` is absent).
- Browser-level UI interaction and E2E behavior.
- Prompt-injection resistance against a broad adversarial corpus.

### Partially implemented

- OCR: the adapter, configuration flag and honest `OCR_UNAVAILABLE` behavior exist, but no OCR engine is installed and no image OCR was executed.
- Provider answer quality: the integration and fallback are implemented, but no live model was evaluated.
- Consistency coverage: the listed deterministic rules are implemented; customs/legal rules and line-item arithmetic are not exhaustive.

### Blocked

- Real OCR execution: requires `pytesseract`/tesseract and a tested image path.
- Production backup/restore assurance for Phase 2 rows: requires an approved drill environment.
- Real provider evaluation: requires an approved key or local Ollama model.

### Not implemented

- Malware scanning (status is honestly `not_scanned`).
- Vector/semantic RAG or pgvector indexing.
- Trained delay-prediction or risk ML models.
- Live weather, port congestion, carrier performance, customs or AIS data.
- Planned ETA field and delay-in-days estimation.
- Background job queue, scheduled processing or automatic retry worker.
- Signed document download URLs and document retention policy.
- Production monitoring/alerting for AI failures.
- E2E browser tests.

---

## 11. Limitations and follow-up work

1. Install `pypdf` and verify PDF extraction on representative files; treat scanned PDFs as `OCR_UNAVAILABLE` until a scanner is installed.
2. Install and configure tesseract before enabling `AI_OCR_ENABLED=true`; then test image OCR and Arabic text quality.
3. Add a malware scanner integration; until then keep `not_scanned` visible.
4. Add a planned ETA field before offering delay-in-days estimates; do not infer one from creation date.
5. Evaluate a real provider with a controlled key, record cost/latency, and test structured extraction quality.
6. Run an approved production/disaster-recovery backup and restore drill; the local Phase 2 drill is complete.
7. Add browser E2E tests for upload → process → findings → Copilot → risk.
8. Consider a background queue for large PDFs; current processing is synchronous.
9. Implement document retention, deletion and signed access controls.
10. Do not claim Phase 2 is production-ready until the external dependencies and drills above are completed.

---

## 12. Files added or changed

Key additions:

- `apps/api/src/ai/gateway.ts`
- `apps/api/src/ai/execution.ts`
- `apps/api/src/ai/retrieval.ts`
- `apps/api/src/ai/copilot.ts`
- `apps/api/src/documents/content.ts`
- `apps/api/src/documents/extraction.ts`
- `apps/api/src/documents/processor.ts`
- `apps/api/src/intelligence/consistency.ts`
- `apps/api/src/intelligence/risk.ts`
- `apps/api/src/intelligence/routes.ts`
- `apps/api/prisma/migrations/20261021120000_phase2_intelligence/migration.sql`
- Tests under `apps/api/src/ai/__tests__`, `apps/api/src/documents/__tests__`, `apps/api/src/intelligence/__tests__`, and `apps/api/src/__tests__/phase2-intelligence.test.ts`.

Key modifications:

- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.ts`
- `apps/api/src/ai/routes.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/documents/routes.ts`
- `apps/api/src/storage/adapter.ts`
- `apps/api/scripts/db-tables.ts`
- `apps/ai-service/main.py`
- `apps/ai-service/requirements.txt`
- `apps/web/app/(app)/documents/page.tsx`
- `apps/web/app/(app)/ai/page.tsx`
- `apps/web/app/(app)/shipments/[id]/page.tsx`
- `.env.example`
