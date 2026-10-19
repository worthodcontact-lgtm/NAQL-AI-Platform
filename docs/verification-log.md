# NAQL AI — Verification Log

Every result below was produced by a command run on this machine. Nothing here is
inferred, estimated, or copied from a previous report.

Environment: Windows, Node v24.11.1, pnpm 9.15.0, non-administrator user, no Docker.
PostgreSQL 16.14 started from local binaries via `embedded-postgres` on `127.0.0.1:5433`.

## 1. Database

### 1.1 Cluster start

```powershell
pnpm --filter @naql/api db:dev
```

Result: PostgreSQL 16 initialised `.pgdata`, started, and created database `naql_ai`.

> Note: PostgreSQL 18.4 (the first version installed) crashed during `initdb` with
> `0xC0000005`. The project pins `embedded-postgres@16.14.0-beta.17` instead.

### 1.2 Migrations

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
npx prisma migrate deploy
npx prisma migrate status
```

Result:

```
2 migrations found in prisma/migrations
Applying migration `20261019010000_membership_multi_role_and_indexes`
All migrations have been successfully applied.
Database schema is up to date!
```

### 1.3 Seed

```powershell
npx tsx prisma/seed.ts
```

Result:

```
Seed complete: 20 created, 0 updated, 20 ports total.
Note: coordinates are approximate and labelled as such; no live or official data is seeded.
```

### 1.4 Reference data over HTTP

```powershell
Invoke-RestMethod "http://127.0.0.1:4100/api/v1/ports?country=EG"
```

Result: 18 items, all from PostgreSQL, all `verificationStatus = "approximate"`.

## 2. Persistence across a restart

1. Registered a user and created a company (id `cmvehz0fr0005xkckjabjnvbt`).
2. Stopped the API process (`Stop-Process -Id 15720 -Force`).
3. Started a fresh API process.
4. Logged in with the same credentials and listed companies.

Result:

```
MATCH: True
company id preserved: cmvehz0fr0005xkckjabjnvbt
```

Conclusion: the record was read from PostgreSQL, not from process memory.

## 3. Automated tests

### 3.1 Without a database (development fallback)

```powershell
cd apps/api; npx vitest run
```

```
Test Files  3 passed | 1 skipped (4)
     Tests  17 passed | 2 skipped (19)
```

### 3.2 With PostgreSQL

```powershell
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
cd apps/api; npx vitest run
```

```
Test Files  4 passed (4)
     Tests  19 passed (19)
```

`src/__tests__/postgres-persistence.test.ts` only runs when `DATABASE_URL` is set, so the
default suite stays fast and infrastructure-free.

### 3.3 Type checks

```
pnpm --filter @naql/api typecheck   -> passed (tsc --noEmit, no output)
pnpm --filter @naql/web typecheck   -> passed (tsc --noEmit, no output)
```

## 4. API end-to-end (real PostgreSQL)

Script: 18 assertions covering the full commercial workflow.

```
PASS  register 3 orgs
PASS  provider company
PASS  customer creates RFQ
PASS  provider inbox contains RFQ
PASS  stranger inbox empty
PASS  stranger cannot quote on RFQ            status=403
PASS  provider submits quote                  total=2750 (excluded item not counted)
PASS  customer accepts -> booking requested
PASS  customer self-confirm blocked           status=403
PASS  stranger confirm blocked                status=403
PASS  stranger booking list isolated
PASS  provider sees booking                   viewerRole=provider
PASS  confirm requires reference              status=400
PASS  provider confirms booking               status=confirmed
PASS  provider adds tracking event            source=manual-provider
PASS  customer sees confirmed booking + event
PASS  seeded EG ports                         count=18
PASS  persistence mode                        mode=database

=== SUMMARY ===
18/18 passed
```

## 5. Production build

```powershell
$env:NEXT_DIST_DIR=".next-verify"; pnpm --filter @naql/web build
```

Result: build succeeded, 20 static pages generated, 22 routes total, shared JS 87.3 kB.
`.next-verify` was removed afterwards and the automatic `tsconfig.json` edit was reverted.

## 6. Issues found by running against a real database (and fixed)

These would not have been visible in the in-memory fallback:

1. **Decimals were serialised as strings in database mode.** `totalAmount` and `weightKg`
   arrived as `"1600"` while the fallback returned `1600`. Fixed with a single
   `preSerialization` normalisation hook in `app.ts`.
2. **`confirmedAt` is `null` in the database and `undefined` in the fallback.** A test
   asserted `undefined`. The assertion now accepts both meanings of "unconfirmed".
3. **Shipments could only be created with internal port ids**, so seeded codes such as
   `ALY` were rejected. `POST /shipments` now resolves either a code or an id.
4. **`accountType` was ignored in database mode**, so reviewer and admin flows could not be
   exercised against PostgreSQL. Role resolution is now shared by both branches.
5. **`Membership` allowed only one role per user per organization.** The unique key is now
   `(organizationId, userId, role)`.
6. **`GET /bookings/:id` did not return tracking events in database mode.** Fixed.

## 7. Not verified

- Cross-tenant file download: real uploads are not implemented yet.
- AI behaviour: no provider is configured, so every AI endpoint returns a labelled fallback.
- Password reset, email verification, MFA: not implemented.
- Browser-level E2E (Playwright/Cypress): not installed.
- Load, performance, and accessibility measurements: not collected.

## 8. API-key audit and runtime re-verification (second session)

### 8.1 `apikey.txt`

Audited by a script that reported only metadata (size, line count, SHA-256, variable
name, value length, and a provider classification derived from public key prefixes).
No secret value was printed.

Result:

- `apikey.txt` exists at the repository root and is **0 bytes / empty**. No variable
  name, token, or JSON object is present.
- SHA-256 is `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`,
  which is the digest of the empty string.
- The file was never committed (`git log --all -- apikey.txt` returns nothing), so
  there is no historical key to recover.
- **No provider can be identified**, because there is no key.

### 8.2 Existing provider integration

- `grep -r "AI_PROVIDER|OPENAI|ANTHROPIC|OLLAMA|AI_API_KEY|AI_BASE_URL|AI_MODEL"`
  over `apps/` matches exactly one string: the fallback message inside
  `apps/ai-service/main.py`. **No code reads a provider key.**
- `apps/api/src/ai/client.ts` only calls `AI_SERVICE_URL`. `apps/ai-service` is a
  deterministic FastAPI placeholder using `fastapi`, `uvicorn`, `pydantic`, and
  `python-multipart`; `httpx` and `python-dotenv` are declared but unused.
- Consequence: adding a key to `.env` today would have **no effect**. A provider
  abstraction has to be implemented before any key can be wired in.

### 8.3 Provider-availability honesty fix

Before the fix, with the AI service running, `POST /api/v1/ai/copilot` returned
`providerAvailable: true` while the answer text said "AI provider not configured".
A reachable HTTP service was being reported as an operational model.

Changed:

- `apps/ai-service/main.py` — `/copilot/answer`, `/documents/validate`, and
  `/predict/delay` now return `providerAvailable: false`.
- `apps/api/src/ai/client.ts` — propagates the service flag and treats anything other
  than an explicit `true` as unavailable.

### 8.4 Runtime checks (13/13)

```text
PASS  GET /health                     persistenceMode=database
PASS  GET /ready                      database=connected
PASS  persistence is database         mode=database
PASS  seeded EG ports                 count=18
PASS  protected route rejects anonymous  status=401
PASS  register + token
PASS  GET /auth/me
PASS  authenticated shipment list     items=0
PASS  cross-tenant shipment blocked   status=404
PASS  shipment created with port code origin resolved from code ALY
PASS  AI reports no provider          providerAvailable=False confidence=0
PASS  delay prediction reports no model method=placeholder-interface days=0
PASS  ai-service reachable            service=naql-ai-service
```

### 8.5 Test and build results

| Command | Result |
|---|---|
| `pnpm --filter @naql/api typecheck` | pass |
| `pnpm --filter @naql/api build` | pass |
| `pnpm --filter @naql/api test` (with `.env`) | 19 passed / 4 files |
| `NAQL_DISABLE_ENV_FILE=1 pnpm --filter @naql/api test` | 17 passed, 2 skipped |
| `pnpm --filter @naql/web typecheck` | pass |
| `pnpm --filter @naql/web build` (`NEXT_DIST_DIR=.next-verify`) | compiled successfully, 20/20 static pages |

`apps/ai-service` has no automated test suite. Its endpoints were exercised manually:
`/health`, `/copilot/answer`, and `/landed-cost` (deterministic math: 1000 + 200 + 50 +
100 duty + 30 fees = 1380; 14% tax = 193.20; total = 1573.20).

### 8.6 Secrets hygiene

- `apikey.txt` and `.env` are both git-ignored.
- `.env` contains only local development values (database URL, JWT secret, CORS
  origins) and **no provider key**.
- No secret was printed in any command, log, document, or report.

