# PHASE 3 SETUP — Local and Production Checklist

**Repository:** `E:\naql ai`  
**Stack:** pnpm workspace, Fastify API, Next.js web, Prisma/PostgreSQL, optional Python extraction service.  
**Docker is not required.**

---

## 1. Prerequisites

- Node.js 20+
- pnpm 9.15+
- PostgreSQL reachable from the API; the repository includes a local dev helper
- Python 3.11+ only if you need the optional extraction service
- Native Tesseract only if you need image/scanned-PDF OCR

Install workspace dependencies:

```powershell
pnpm install
```

---

## 2. Local database

The repository’s local helper starts an embedded PostgreSQL cluster on port `5433`:

```powershell
pnpm --filter @naql/api db:dev
```

Create/use the development database `naql_ai` and, separately, the test database `naql_ai_phase1_api`. Migrations must be applied with Prisma:

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
$env:DIRECT_URL=$env:DATABASE_URL
pnpm --filter @naql/api exec prisma migrate deploy --schema prisma/schema.prisma
```

Check status:

```powershell
pnpm --filter @naql/api exec prisma migrate status --schema prisma/schema.prisma
```

Do **not** run `prisma migrate reset`, truncate tables, or point the CLI at production while developing. Phase 3 is additive and must remain additive.

---

## 3. API environment

Copy `.env.example` to `.env` and fill local values. Key Phase 3 settings:

```dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public
DIRECT_URL=postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public
JWT_SECRET=<at-least-32-random-characters-in-production>
CORS_ORIGINS=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### Secure storage

```dotenv
STORAGE_PATH=E:\naql-data\documents
MAX_DOCUMENT_BYTES=2097152
```

- `STORAGE_PATH` must be writable by the API process and **outside** `apps/web`.
- The API refuses to start in production without `STORAGE_PATH`; development may use the in-memory map, but those bytes disappear on restart.
- The API body limit is 4 MB so a 2 MB decoded upload plus base64/JSON overhead is accepted.
- Do not serve `STORAGE_PATH` through Next.js, IIS, Nginx `root`, or any static handler. Bytes must be fetched through the authenticated API.
- S3-compatible variables are reserved but **not implemented** in this build.

### Malware scanner

Default:

```dotenv
MALWARE_SCANNER=none
```

Every upload is then recorded as `not_scanned`. This is not a clean scan.

Optional ClamAV clamd:

```dotenv
MALWARE_SCANNER=clamav
MALWARE_SCANNER_HOST=127.0.0.1
MALWARE_SCANNER_PORT=3310
MALWARE_SCANNER_TIMEOUT_MS=5000
MALWARE_SCAN_FAIL_CLOSED=true
```

- clamd must be running and reachable; Docker is optional and not required by the app.
- A configured scanner that cannot answer rejects uploads when fail-closed is true.
- Infected files are rejected before storage.
- Real detection was **not verified** in this environment because no clamd daemon was available.

### Retention

```dotenv
DOCUMENT_RETENTION_DAYS=0
COMPANY_DOCUMENT_RETENTION_DAYS=0
```

`0` disables expiry. Set a positive number only with an agreed policy.

Dry run first:

```powershell
pnpm --filter @naql/api documents:retention
```

Apply after reviewing:

```powershell
pnpm --filter @naql/api documents:retention -- --apply
```

The script soft-deletes metadata before removing bytes. A failure is reported; it does not pretend deletion succeeded. Back up metadata and storage before applying in production.

### AI provider

```dotenv
AI_PROVIDER=none
AI_MODEL=
AI_API_KEY=
AI_BASE_URL=
AI_MAX_RETRIES=1
AI_OCR_ENABLED=false
AI_RAG_TOP_K=5
```

- `none` is the supported default. Copilot returns deterministic degraded output and reports `providerAvailable=false`.
- Supported provider values: `none`, `openai`, `openai-compatible`, `ollama`.
- Real provider calls were not tested because no credentials/model were available.
- Keys are server-side only. Never put them in `NEXT_PUBLIC_*`.
- Cost depends on the provider/model chosen outside this repository; document the model, region, token limits, and budget before enabling.

### Notifications

No Redis, queue, SMTP, or WhatsApp credentials are required. Notifications are persisted in PostgreSQL and shown in-app.

External delivery is not implemented. The API/UI report `provider_unavailable`; retry returns `503 notification_provider_unavailable` and leaves `inAppPersisted: true`.

---

## 4. Optional Python extraction service

```powershell
cd apps/ai-service
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Health:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health
```

Expected local capabilities:

- `textExtraction: true`
- `pdfText: true` when `pypdf` is installed
- `pdfOcr` / `ocr: false` until `pypdfium2`, `pytesseract`, **and** the native Tesseract executable are installed

The API remains usable for text files and deterministic extraction if the Python service is down; PDF/image extraction then reports unavailable with no invented text.

### OCR (optional, not verified)

1. Install `pypdfium2` and `pytesseract` from `requirements.txt`.
2. Install native Tesseract and ensure `tesseract` is on `PATH`.
3. Set `AI_OCR_ENABLED=true`.
4. Keep `MAX_OCR_PAGES` small (default 5) and test CPU/memory on the target machine before enabling.

No OCR success is claimed in this environment.

---

## 5. Run locally

Terminal 1 — database:

```powershell
pnpm --filter @naql/api db:dev
```

Terminal 2 — API:

```powershell
pnpm --filter @naql/api dev
```

Terminal 3 — web:

```powershell
pnpm --filter @naql/web dev
```

Open `http://localhost:3000`.

If `prisma generate` fails with `EPERM ... query_engine-windows.dll.node`, stop the running API/tsx watcher before generating/building. The Windows Prisma DLL cannot be replaced while a process holds it.

---

## 6. Verification commands

### API typecheck and build

```powershell
pnpm --filter @naql/api typecheck
pnpm --filter @naql/api build
```

### API database suite

Use the dedicated test database, not the development database:

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai_phase1_api?schema=public"
pnpm --filter @naql/api exec vitest run
```

### No-database fallback

```powershell
$env:NAQL_DISABLE_ENV_FILE="1"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
pnpm --filter @naql/api exec vitest run
```

Skipped database tests are expected; skipped is not the same as passed.

### Python service

```powershell
python -m pytest apps/ai-service/test_main.py -q
```

### Web typecheck and build

```powershell
pnpm --filter @naql/web typecheck
pnpm --filter @naql/web build
```

### Prisma

```powershell
pnpm --filter @naql/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @naql/api exec prisma migrate status --schema prisma/schema.prisma
```

### Phase 3 focused suite

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai_phase1_api?schema=public"
pnpm --filter @naql/api exec vitest run src/__tests__/phase3-operations.test.ts
```

---

## 7. Actual verification results for this pass

| Check | Result |
|---|---|
| API typecheck | Passed |
| API build (after stopping the dev watcher) | Passed |
| PostgreSQL API suite | **138/138 passed, 16 files** |
| No-database suite | **90 passed, 48 skipped** |
| Python extraction tests | **6 passed** |
| `py_compile` for `main.py` | Passed |
| Web typecheck | Passed |
| Web production build | Passed, 44 app route entries |
| Prisma validate | Passed |
| `prisma migrate status` — `naql_ai` | Up to date, 6 migrations |
| `prisma migrate status` — `naql_ai_phase1_api` | Up to date, 6 migrations |
| Browser smoke | Registration, notifications page, secure text upload, processing, extraction display, authenticated download; no console errors in the exercised pages |
| Real ClamAV | Not available |
| Real OCR | Blocked (no native Tesseract) |
| Real AI provider | Blocked (no credentials) |
| Live tracking | Blocked by design |
| Automated browser E2E | Not implemented |

The API build initially failed with a Windows `EPERM` while `tsx watch` held the Prisma engine; stopping the watcher made the build pass. This is an environment issue, not a code failure.

---

## 8. Production checklist

### Database and migrations

- [ ] Back up the database and verify restore before deployment.
- [ ] Apply migrations with `prisma migrate deploy`, never reset.
- [ ] Confirm partial unique indexes exist for accepted quotes and awarded offers.
- [ ] Confirm no production data is deleted by the migration.

### Storage

- [ ] Set `STORAGE_PATH` to a persistent volume outside the web root.
- [ ] Restrict filesystem permissions to the API service account.
- [ ] Exclude the directory from web servers, static export, backups exposed publicly, and source control.
- [ ] Verify upload/download through the API only.
- [ ] Implement S3-compatible storage separately if required; it is not included.

### Security

- [ ] Set a random `JWT_SECRET` of at least 32 characters.
- [ ] Set an explicit `CORS_ORIGINS` allow-list.
- [ ] Configure a malware scanner and verify it fails closed.
- [ ] Confirm rate limiting at the edge and at the API.
- [ ] Confirm audit logs are retained and access-controlled.
- [ ] Confirm no secrets are in `NEXT_PUBLIC_*`, logs, or the repository.
- [ ] Test cross-organization document access again after deployment.
- [ ] Confirm admin document access requires a reason.

### Operations

- [ ] Configure retention days and run a dry run before `--apply`.
- [ ] Monitor storage full/errors; the API returns `503` rather than losing bytes silently.
- [ ] Monitor extraction service availability and OCR resource usage.
- [ ] Confirm notification delivery boundary remains honest if email/WhatsApp adapters are added later.
- [ ] Confirm live tracking remains unavailable until a real carrier/AIS/customs integration is verified.

### Frontend

- [ ] Set `NEXT_PUBLIC_API_URL` to the deployed API.
- [ ] Build the Next.js app and verify the Arabic RTL pages against the real API.
- [ ] Verify authenticated binary downloads work behind the deployment proxy.
- [ ] Verify no page shows fabricated success, GPS, ETA, or provider delivery.

---

## 9. Known limitations

- No production S3/object-storage backend.
- No verified ClamAV deployment.
- No native Tesseract/OCR verification.
- No live carrier/AIS/customs tracking.
- No external email/WhatsApp delivery adapter.
- No real AI provider evaluation.
- No automated browser E2E suite; only a manual smoke.
- A withdrawn quote cannot be resubmitted for the same company/RFQ.
- Booking-to-shipment linkage is optional because RFQs have no shipment field.
- Phase 3 changes are uncommitted and were not deployed.
