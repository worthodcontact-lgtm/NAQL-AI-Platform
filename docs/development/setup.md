# NAQL AI — Local Development

## Prerequisites
- Node.js 20+
- pnpm 9+
- Python 3.11+ (optional, for PDF/OCR extraction)
- PostgreSQL 15+ with PostGIS (optional; Phase 2 uses ordinary relational tables)
- Redis (optional, for background jobs; not used by Phase 2 processing)

## Native PostgreSQL on Windows (no Docker)
Option A (recommended): official installer from https://www.postgresql.org/download/windows/

1. Install PostgreSQL 15+ and pgAdmin.
2. Install PostGIS using Stack Builder or the PostGIS bundle for your PostgreSQL version.
3. Open SQL Shell (psql) as the postgres superuser:
   ```sql
   CREATE USER naql WITH PASSWORD 'change-me';
   CREATE DATABASE naql_ai OWNER naql;
   \c naql_ai
   CREATE EXTENSION IF NOT EXISTS postgis;
   GRANT ALL PRIVILEGES ON DATABASE naql_ai TO naql;
   ```
4. Set the API environment variable:
   ```text
   DATABASE_URL=postgresql://naql:change-me@localhost:5432/naql_ai
   ```

Option B (winget):
```powershell
winget install PostgreSQL.PostgreSQL
```
Then run the same SQL commands in `psql`.

## Setup
1. Copy `.env.example` to `.env` and adjust.
2. `pnpm install`
3. Generate Prisma client: `pnpm --filter @naql/api prisma:generate`
4. Run migrations: `pnpm --filter @naql/api prisma:migrate`
5. Seed development data: `pnpm --filter @naql/api prisma:seed`
6. Start API: `pnpm --filter @naql/api dev`
7. Start web: `pnpm --filter @naql/web dev`
8. Start AI service:
   - `cd apps/ai-service`
   - `python -m venv .venv`
   - `.venv\Scripts\activate`
   - `pip install -r requirements.txt`
   - `uvicorn main:app --reload --port 8000`

## Migration workflow
- Edit `apps/api/prisma/schema.prisma`.
- Create migration: `pnpm --filter @naql/api prisma:migrate`.
- Review generated SQL under `apps/api/prisma/migrations`.
- Regenerate client after schema changes: `pnpm --filter @naql/api prisma:generate`.

## Phase 2 intelligence setup
- Full setup, provider configuration and verification commands: `docs/PHASE-2-SETUP.md`.
- Default `AI_PROVIDER=none` keeps Copilot in an explicit deterministic/degraded mode.
- Text documents process without the Python service. PDF text requires `pypdf`; image OCR requires `pytesseract`, Pillow and the native Tesseract executable.
- Malware scanning is not configured; every extraction reports `malwareScanStatus: "not_scanned"`.
- The Phase 2 migration is additive: `20261021120000_phase2_intelligence`.

## Notes
- Without `DATABASE_URL`, API runs in development fallback mode for auth and shipments.
- Quotes, documents, and production tenant isolation require PostgreSQL.
- External integrations are labeled as unavailable by default.
- AI endpoints return `providerAvailable: false` when no provider is configured.
