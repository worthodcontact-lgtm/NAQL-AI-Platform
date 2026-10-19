# NAQL AI — Local Development (native Windows)

No Docker and no administrator rights are required.

## Prerequisites

- Node.js >= 20
- pnpm 9 (`packageManager` is pinned in the root `package.json`)
- Python 3.10+ — only needed for the optional AI service

Add the global pnpm location to the session PATH if `pnpm` is not already resolvable:

```powershell
$env:Path = "C:\Users\super\AppData\Roaming\npm;" + $env:Path
```

## 1. Install dependencies

```powershell
cd "E:\naql ai"
pnpm install
```

## 2. Start a real PostgreSQL database

The repository can run a real PostgreSQL 16 cluster from local binaries. This needs no
Windows service and no administrator rights.

```powershell
pnpm --filter @naql/api db:dev
```

This creates `E:\naql ai\.pgdata` (git-ignored) and listens on `127.0.0.1:5433` with
database `naql_ai`, user `naql`, password `naql`. Leave it running.

In a second terminal, point the API at it:

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
```

### Alternative: an installed PostgreSQL

If PostgreSQL is installed locally (or hosted), simply set `DATABASE_URL` to that
instance and skip `db:dev`:

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naql_ai?schema=public"
```

To install natively with administrator rights:

```powershell
winget install --id PostgreSQL.PostgreSQL.16 -e
```

## 3. Create the schema and seed reference data

```powershell
pnpm --filter @naql/api prisma:generate
pnpm --filter @naql/api prisma:deploy      # applies committed migrations
pnpm --filter @naql/api prisma:seed        # idempotent reference data (ports)
```

While iterating on the schema:

```powershell
pnpm --filter @naql/api prisma:migrate
```

> `prisma migrate dev` refuses to run in a non-interactive shell. Generate the SQL with
> `prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script`,
> save it under `prisma/migrations/<timestamp>_<name>/migration.sql`, then run
> `prisma migrate deploy`.

## 3.1 Run the database-backed tests

The PostgreSQL test file is skipped unless `DATABASE_URL` is set, so the normal suite stays
fast:

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
pnpm --filter @naql/api test
```

Expected with a database: 19 passing tests across 4 files. Without one: 17 passing and
2 skipped.

## 4. Run the application

```powershell
pnpm dev
```

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| API health | http://localhost:4000/health |
| API readiness | http://localhost:4000/ready |

## 5. Optional AI service

```powershell
cd "E:\naql ai\apps\ai-service"
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

Without a configured provider the AI endpoints return an explicitly labelled fallback.
They never fabricate an answer.

## Persistence behaviour

- `DATABASE_URL` set → `persistenceMode: "database"`. Data survives restarts.
- `DATABASE_URL` absent → `persistenceMode: "memory"`. The web app shows a warning banner
  and the API reports it on `/health`. All data is lost on restart.
- `NODE_ENV=production` without `DATABASE_URL` → the API **refuses to start**.

## Environment variables

Copy `.env.example` to `.env` in the repository root and adjust it. The API loads the
repository-root `.env` and `apps/api/.env` at start-up using Node's built-in loader, so you
do **not** need to set variables in every PowerShell session. Real environment variables
still win over the file.

Turbo only forwards the variables listed in `turbo.json` → `globalEnv`. Add any new
variable there, or it will not reach the app processes.

Only `NEXT_PUBLIC_*` variables reach the browser.

## Useful commands

```powershell
pnpm --filter @naql/api typecheck
pnpm --filter @naql/api test
pnpm --filter @naql/api build
pnpm --filter @naql/web typecheck
pnpm --filter @naql/web build
```

> Running `next build` while `next dev` is running corrupts the shared `.next` folder.
> Stop the dev server first, or build with a separate output directory:
>
> ```powershell
> $env:NEXT_DIST_DIR=".next-verify"; pnpm --filter @naql/web build
> ```

## Troubleshooting

**`PageNotFoundError: Cannot find module for page`** — a build collided with a running dev
server. Stop the dev server, delete `.next`, and rebuild.

**Port 5433 already in use** — another cluster is running. Stop it, or set
`$env:NAQL_DEV_DB_PORT="5434"` and update `DATABASE_URL` accordingly.

**API returns `devFallback: true` everywhere** — `DATABASE_URL` is not set in the API process.
