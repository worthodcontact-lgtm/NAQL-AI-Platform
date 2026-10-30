# PHASE 2 SETUP — Document AI & Intelligence

This guide covers local setup and verification of the Phase 2 intelligence layer. It assumes the existing Phase 1 project is already installed.

**Do not use this guide to run a production migration.** Production changes require approval, a verified backup and a restore plan.

---

## 1. Prerequisites

- Node.js 20 or newer.
- pnpm 9.15 (the repository pins `pnpm@9.15.0`).
- PostgreSQL with the Phase 2 migration applied.
- Optional: Python 3.10+ for the PDF/OCR extraction service.
- Optional: Tesseract OCR executable for image/scanned-PDF OCR.

Docker is **not** required.

The local development database is normally the embedded PostgreSQL cluster on `127.0.0.1:5433`; the test database used in the verification record is `naql_ai_phase1_api`.

---

## 2. Environment variables

Copy `.env.example` to `.env` and adjust values. Never commit `.env` or real credentials.

### Required / existing

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Runtime PostgreSQL connection string. |
| `DIRECT_URL` | Prisma CLI connection string; usually the direct (non-pooler) URL. |
| `JWT_SECRET` | Session signing secret. Use a long random value outside development. |
| `CORS_ORIGINS` | Allowed web origins. |
| `STORAGE_PATH` | Optional local storage root. Leave empty for the in-memory development store. |
| `NEXT_PUBLIC_API_URL` | Browser-visible API URL. |

### Phase 2 / AI

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `none` | `none`, `openai`, `openai-compatible`, or `ollama`. |
| `AI_MODEL` | empty | Provider model name. Required for a configured provider. |
| `AI_API_KEY` | empty | Server-side provider key. Required for `openai` and normally `openai-compatible`; not needed for Ollama. |
| `AI_BASE_URL` | provider default | Base URL for OpenAI-compatible or Ollama endpoints. |
| `AI_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `AI_MAX_RETRIES` | `1` | Bounded retries on transient failures; clamped to 0–3. |
| `AI_OCR_ENABLED` | `false` | Gate for image OCR in the Python service. Leave false until Tesseract is installed and tested. |
| `AI_RAG_TOP_K` | `5` | Maximum chunks used by Copilot retrieval; clamped to 1–20. |
| `AI_SERVICE_URL` | `http://127.0.0.1:8000` | Optional Python text/PDF/OCR service. |

`AI_PROVIDER=none` is the safe default. Deterministic extraction, consistency, retrieval, risk, delay and Copilot summaries continue to work without a paid provider.

---

## 3. Database migration

The migration is:

`apps/api/prisma/migrations/20261021120000_phase2_intelligence/migration.sql`

It is additive and creates the Phase 2 tables plus nullable `Document.contentType` and `Document.size`.

For local development or a disposable test database:

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
$env:DIRECT_URL=$env:DATABASE_URL

pnpm --filter @naql/api prisma:generate
pnpm --filter @naql/api prisma:deploy
```

For the API test database:

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai_phase1_api?schema=public"
$env:DIRECT_URL=$env:DATABASE_URL

pnpm --filter @naql/api prisma:deploy
```

Check status:

```powershell
pnpm --filter @naql/api exec prisma migrate status
```

Validate the schema without touching a database:

```powershell
pnpm --filter @naql/api exec prisma validate --schema prisma/schema.prisma
```

If the Prisma client cannot be regenerated because `query_engine-windows.dll.node` is locked, stop the API dev server first.

---

## 4. Install and start

From the repository root:

```powershell
pnpm install
pnpm --filter @naql/api dev
```

In another terminal:

```powershell
pnpm --filter @naql/web dev
```

Default URLs:

- API: `http://127.0.0.1:4000`
- Web: `http://127.0.0.1:3000`
- Health: `GET http://127.0.0.1:4000/health`
- Readiness: `GET http://127.0.0.1:4000/ready`

The API exposes `/api/v1/ai/status` to authenticated users so the UI can show provider availability without exposing secrets.

---

## 5. Provider configuration

### 5.1 No provider (default, recommended for local verification)

```env
AI_PROVIDER=none
```

- Copilot returns `status: "degraded"`.
- The answer is a deterministic summary from authorized records.
- No model, key or network call is used.
- Deterministic document extraction and consistency still run.

### 5.2 OpenAI

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_API_KEY=replace-with-a-server-side-key
AI_BASE_URL=
```

The adapter calls the OpenAI-compatible chat completions endpoint. Never place the key in a `NEXT_PUBLIC_*` variable.

### 5.3 OpenAI-compatible endpoint

```env
AI_PROVIDER=openai-compatible
AI_MODEL=your-model
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=replace-with-a-server-side-key
```

`AI_BASE_URL` should include the version path expected by the provider.

### 5.4 Ollama

```env
AI_PROVIDER=ollama
AI_MODEL=llama3.1
AI_BASE_URL=http://127.0.0.1:11434
AI_API_KEY=
```

The Ollama adapter calls `/api/chat`; no API key is required.

Provider failures are normalized and do not crash the API. Copilot falls back to a degraded deterministic answer, and document processing falls back to deterministic fields.

---

## 6. Optional Python extraction service

The API decodes plain text directly. PDF text and image OCR use the service in `apps/ai-service`.

### Install

```powershell
cd apps\ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

`requirements.txt` includes `pypdf`, `pytesseract` and Pillow. Installing the Python packages does **not** install the native Tesseract executable. Install Tesseract separately and ensure it is on `PATH` before enabling OCR.

### Start

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### Capability check

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected honest behavior when optional PDF/OCR packages are absent:

```json
{
  "status": "ok",
  "service": "naql-ai-service",
  "version": "0.2.0",
  "capabilities": {
    "textExtraction": true,
    "pdfText": false,
    "ocr": false
  }
}
```

Do not enable `AI_OCR_ENABLED=true` until both the Python OCR packages and the Tesseract binary are verified.

If the service is down or the capability is missing, processing returns an explicit `unavailable` result or `OCR_UNAVAILABLE`; it never invents text.

---

## 7. Document processing notes

- Upload maximum: 2 MB.
- Supported types: PDF, PNG, JPEG, CSV, JSON, XML, TXT.
- MIME type, extension and content signature must agree.
- The API stores files under a server-generated storage key.
- Text files can be processed without the Python service or a model provider.
- PDF text requires `pypdf` in the Python service.
- Image/scanned PDF OCR requires `pytesseract`, Pillow and the Tesseract binary.
- Malware scanning is not configured. Results always show `malwareScanStatus: "not_scanned"` and a warning.
- Processing is synchronous. A large PDF can occupy the request until the configured timeout.
- Extracted text is persisted server-side for provenance and is not returned by document APIs.

---

## 8. Tests and checks

### API suite with a database

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai_phase1_api?schema=public"
$env:DIRECT_URL=$env:DATABASE_URL

pnpm --filter @naql/api test
```

### API suite without a database

```powershell
$env:NAQL_DISABLE_ENV_FILE="1"
$env:DATABASE_URL=""
$env:DIRECT_URL=""

pnpm --filter @naql/api test
```

This verifies the in-memory/fallback paths and skips database-only tests.

### Typechecks

```powershell
pnpm --filter @naql/api typecheck
pnpm --filter @naql/web typecheck
```

### Web production build

Stop the web dev server first, then:

```powershell
pnpm --filter @naql/web build
```

### Python syntax

```powershell
python -m py_compile apps/ai-service/main.py
```

---

## 9. Operational limits

- No background queue or scheduled reprocessing exists; document processing is request-driven.
- No malware scanner is integrated.
- No vector database or embedding index exists; retrieval is deterministic keyword matching.
- No live weather, port congestion, carrier performance, customs or AIS feed is configured.
- No planned ETA field exists, so delay-in-days remains `null` with `insufficient_data`.
- Risk and delay are deterministic operational indicators, not trained ML models.
- No document retention or signed download policy is implemented.
- AI provider cost/latency is recorded in `AiExecution`; there is no alerting dashboard.

---

## 10. Production safety

Before any production migration:

1. Obtain explicit approval.
2. Take and verify a production backup.
3. Test restore into a disposable/staging database.
4. Confirm the migration only adds tables/columns.
5. Verify `DIRECT_URL` points to the correct production database.
6. Apply the migration through the approved deployment process.
7. Re-run health checks and a document-processing smoke test.

No production migration, deployment, credential rotation or production backup was performed as part of this implementation.
