# PHASE 2 AUDIT — Intelligence Engine & Document AI

**Audit date:** 2026-10-21  
**Repository:** `E:\naql ai`  
**Branch / HEAD:** `main` at `84f11c2`  
**Status:** Phase 1 working tree is uncommitted and must be preserved.

---

## 1. Baseline verification

The Phase 1 security work was already verified before this audit:

- PostgreSQL API suite: **99/99 passing across 10 files**.
- No-database fallback: **60 passing, 39 skipped**.
- API TypeScript build and test typechecks: passing.
- Prisma schema validation: passing.
- Web typecheck and production build: passing.
- Local `/health` and `/ready`: healthy, database connected.

No production database, deployment, commit, or push was performed.

---

## 2. Current implementation status

| Area | Status | Evidence |
|---|---|---|
| Authentication / sessions | Implemented | JWT + principal reload + `sessionVersion` |
| Organizations / tenancy | Implemented | `Organization`, `Membership`, company roles |
| Shipments / milestones | Implemented | `Shipment`, `ShipmentMilestone` |
| Shipment parties / permissions | Implemented | `ShipmentParty` action flags + `loadShipmentAccess` |
| Documents metadata / storage safety | Implemented | `Document`, secure server-generated storage keys |
| Document AI extraction | **Broken / mock** | API calls `/documents/validate` without multipart file; no OCR/provider |
| Document consistency engine | Not implemented | No findings model or rules |
| AI provider gateway | Not implemented | Only direct `fetch` to Python fallback endpoints |
| Copilot authorization / retrieval | Partial / unsafe | `organizationId` is injected into a context object; no retrieval or source validation |
| RAG | Not implemented | No vectors, chunks, or deterministic retrieval |
| Delay prediction | Placeholder | Fixed `estimatedDelayDays: 0`, `riskLevel: unknown` |
| Risk engine | Not implemented | No scoring or persistence |
| Frontend AI integration | Partial / misleading | “AI validate” button uses alert; Copilot is a free-text fallback |

---

## 3. Existing API contracts

### Existing AI endpoints

- `POST /api/v1/ai/copilot`
  - Request: `{ question, context? }`
  - Response: `{ answer, confidence, sources, disclaimer, providerAvailable }`
  - Problems: no `shipmentId`, no conversation persistence, no authorization of context, no source traceability.

- `POST /api/v1/ai/predict-delay`
  - Request: `{ route, mode, departureDate, carrier? }`
  - Response: `{ estimatedDelayDays, riskLevel, method, disclaimer, providerAvailable }`
  - Problems: accepts client-supplied route/date instead of using an authorized shipment; placeholder response.

- `POST /api/v1/documents/:id/validate`
  - Problems: does not read the stored object, calls the Python service without the required multipart file, and stores an unstructured JSON string.

### Existing document endpoints

- `POST /api/v1/shipments/:id/documents`
- `GET /api/v1/documents?shipmentId=`
- `GET /api/v1/documents/:id`
- `POST /api/v1/documents/:id/validate`

Upload currently validates declared content type and size but not file magic bytes, and does not run malware scanning.

### Existing shipments

- `GET /api/v1/shipments`
- `GET /api/v1/shipments/:id`
- `POST /api/v1/shipments`
- `PATCH /api/v1/shipments/:id/status`
- `DELETE /api/v1/shipments/:id`
- `POST/PATCH/DELETE /api/v1/shipments/:id/parties...`

---

## 4. Existing database models and relations

Relevant models:

- `Organization`
- `User`
- `Membership`
- `Shipment`
- `ShipmentMilestone`
- `Document`
- `ShipmentParty`
- `QuotationRequest`
- `QuotationOffer`
- `Rfq`, `Quote`, `QuoteItem`, `BookingRequest`, `TrackingEvent`
- `AuditLog`

`Document` currently has only:

- `status` (string)
- `validation` (unstructured JSON string)

It has no processing job, extracted text, structured fields, provenance, findings, OCR status, malware status, provider, or model metadata.

---

## 5. Existing AI capabilities

### Python FastAPI service

`apps/ai-service/main.py`:

- `/health` — real.
- `/landed-cost` — deterministic calculator, real.
- `/copilot/answer` — always returns a hard-coded “AI provider not configured” fallback.
- `/documents/validate` — requires `UploadFile`, but the API calls it without a file.
- `/predict/delay` — fixed placeholder response.

No OCR, PDF parsing, provider SDK, embedding, vector, or model call exists.

### TypeScript API

`apps/api/src/ai/client.ts` calls the Python service with fetch and timeouts, but:

- no retries;
- no provider abstraction;
- no usage/latency logging;
- no structured output validation;
- no secret redaction (though no secrets are logged today);
- no distinction between provider failure and business validation failure.

### Environment

`.env.example` already lists:

```text
AI_PROVIDER=none
AI_MODEL=
AI_API_KEY=
AI_BASE_URL=
AI_REQUEST_TIMEOUT_MS=5000
AI_SERVICE_URL=http://127.0.0.1:8000
```

These are not parsed into the API configuration except `AI_SERVICE_URL` and `AI_REQUEST_TIMEOUT_MS`.

---

## 6. Missing functionality

1. Central AI gateway with no-provider mode, provider adapters, retries, timeouts, structured output validation, and redacted usage logs.
2. Secure document content validation (magic bytes) and honest malware-scan status.
3. Text/PDF extraction and OCR adapter with explicit `OCR_UNAVAILABLE`.
4. Document classification and deterministic field extraction.
5. Extracted-field provenance and validation status persistence.
6. Document consistency rules and persisted findings.
7. Authorized Copilot context assembly and conversation persistence.
8. Deterministic retrieval with organization isolation and source references.
9. Delay estimation based on available shipment data, with insufficient-data status.
10. Risk scoring with factors, data completeness, and persisted history.
11. Frontend integration with real processing states, findings, intelligence, and Copilot sources.
12. Tests for provider failure, no-provider mode, extraction, consistency, cross-tenant retrieval, prediction, and risk.
13. Phase 2 documentation and environment setup.

---

## 7. Security risks identified

| Risk | Current state | Required control |
|---|---|---|
| Cross-tenant Copilot leakage | Client context is merged without record-level checks | Build server-side context only from `loadShipmentAccess` and organization-scoped queries |
| Prompt injection via documents | No retrieval exists | Treat retrieved text as untrusted data; delimit it; never execute document instructions |
| Client-supplied organization id | Not trusted today because routes derive principal, but context can include arbitrary data | Never accept organization id from request body |
| Unverified AI output | No output validation | Validate structured output with Zod; never auto-approve customs/legal state |
| Fake availability | Python fallback returns a reachable HTTP 200 | Require explicit provider/status metadata; distinguish `degraded` |
| File content spoofing | Declared content type only | Verify magic bytes and extension; reject mismatches |
| Malware | No scanner | Persist `not_scanned`; never claim scanned |
| OCR false success | None today | Return `OCR_UNAVAILABLE` when no OCR engine |
| Unbounded prompts | No limits | Bound document text, context rows, and request length |
| AI abuse | No endpoint rate limit | Use existing global rate limit and per-request size limits |
| Sensitive logs | No AI logs yet | Redact secrets and document text; log metadata only |

---

## 8. Required environment variables

Existing variables to keep:

```text
AI_SERVICE_URL
AI_REQUEST_TIMEOUT_MS
```

Add or formalize:

```text
AI_PROVIDER=none|openai|openai-compatible|ollama
AI_MODEL=
AI_API_KEY=
AI_BASE_URL=
AI_MAX_RETRIES=1
AI_OCR_ENABLED=false
AI_RAG_TOP_K=5
```

Provider credentials remain server-side only. `none` is the default and must work without paid access.

---

## 9. Phase 2 implementation sequence

1. **Audit and baseline** — this document.
2. **Schema and migration** — processing, fields, findings, AI executions, conversations, risk/delay history.
3. **AI gateway** — provider abstraction, no-provider mode, retries, timeouts, usage metadata.
4. **Document processing** — content signature validation, text/PDF extraction, OCR adapter, deterministic extraction, persistence.
5. **Consistency engine** — deterministic rules, severity, provenance, persistence.
6. **Copilot and retrieval** — authorized context, deterministic retrieval, provider integration, sources, conversation persistence.
7. **Delay and risk** — transparent baselines, data completeness, persisted assessments.
8. **Frontend** — processing status, field review, findings, intelligence, Copilot sources.
9. **Security and tests** — cross-tenant, file validation, fallback, provider failure, rules, migrations.
10. **Documentation and final report** — setup, API, implementation, limitations.

---

## 10. Acceptance criteria

Phase 2 is accepted only when:

- Phase 1 tests still pass.
- No-provider mode is explicit and does not fabricate answers.
- Document processing has a real tested path for supported text formats.
- Unsupported OCR returns `OCR_UNAVAILABLE` rather than success.
- Extracted fields and findings persist with provenance.
- Consistency findings are deterministic, explainable, and tested.
- Copilot and retrieval never cross organization boundaries.
- Delay and risk outputs separate facts from estimates and report missing data.
- Frontend actions call real APIs and show unavailable/degraded states.
- Migration is safe and locally applied.
- Typechecks, builds, and tests are executed and recorded.
- Remaining external requirements are documented honestly.

---

## 11. Implementation record

The Phase 2 implementation and its exact verification results are recorded in:

- `docs/PHASE-2-IMPLEMENTATION.md`
- `docs/PHASE-2-API.md`
- `docs/PHASE-2-SETUP.md`

The migration was applied to local `naql_ai_phase1_api` and `naql_ai` only. No production database, deployment, commit, push or credential rotation was performed.
