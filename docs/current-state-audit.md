# NAQL AI — Current State Audit

> **Historical baseline:** this document describes the pre-Phase-2 state. Current
> Phase 2 implementation and verification are recorded in
> `docs/PHASE-2-IMPLEMENTATION.md`, `docs/PHASE-2-API.md` and
> `docs/PHASE-2-SETUP.md`.

Audit performed by inspecting the actual implementation, not prior reports.
Baseline commit: `1075408` (chore: baseline snapshot before transformation).

## 1. Workspace

| Item | Reality |
|---|---|
| Package manager | pnpm 9.15.0 (`packageManager` pinned), Turborepo 2.3 |
| Node | v24.11.1 on the audit machine (engines require >=20) |
| Apps | `apps/web` (Next.js 14.2), `apps/api` (Fastify 4), `apps/ai-service` (FastAPI) |
| Packages | `packages/shared-types`, `packages/validation`, `packages/ui`, `packages/config` — **none are consumed by any app** (dead code) |
| Git | Repository had **no commits** before the baseline snapshot |
| Docker | Not installed. Not required. |
| PostgreSQL | Originally absent. Now provided natively by `embedded-postgres@16.14.0-beta.17` (`pnpm --filter @naql/api db:dev`), no administrator rights and no Windows service. |
| Current user | Not an administrator |

## 2. Backend API (`apps/api`)

Fastify app factory in `src/app.ts`. Registered plugins: `@fastify/cors` (`origin: true`),
`@fastify/rate-limit` (global 100/min), `@fastify/jwt`. Daily logger disabled (`logger: false`).

| Module | File | Status |
|---|---|---|
| Auth | `src/auth/routes.ts` | Implemented. register/login/me, bcrypt, JWT with `organizationId` + `roles` |
| Roles | `src/auth/roles.ts` | Implemented. `PLATFORM_STAFF_ROLES`, `isPlatformStaff`, `isCompanyManager` |
| Shipments | `src/shipments/routes.ts` | Implemented. CRUD + status transition table, tenant isolated |
| Quotations (legacy) | `src/quotations/routes.ts` | **Semantically inverted** — offers can only be created by the requesting organization (the customer), not by a provider |
| RFQ / Quote / Booking | `src/rfq/routes.ts` | Implemented. RFQ, recipients, quotes, accept, confirm/reject, tracking |
| Companies | `src/companies/routes.ts` | Implemented. register/submit/directory/detail/documents metadata |
| Company ownership | `src/companies/ownership.ts` | Implemented (added during this pass) |
| Admin | `src/admin/routes.ts` | Implemented. overview, companies, audit |
| Audit | `src/audit/log.ts` | Implemented. DB table when available, otherwise in-memory array |
| Documents | `src/documents/routes.ts` | Partial. Metadata + base64 payload; **AI validate call never sends the file** |
| Ports | `src/ports/routes.ts` | Read-only and **returns an empty list** without a database |
| Costs | `src/costs/routes.ts` | Implemented, deterministic, unit tested |
| AI | `src/ai/client.ts`, `src/ai/routes.ts` | Adapter with timeouts and labelled fallback; no provider configured |
| Storage | `src/storage/adapter.ts` | In-memory map by default; local filesystem when `STORAGE_PATH` is set |
| DB access | `src/db.ts` | `prisma = env.DATABASE_URL ? new PrismaClient() : null` |

## 3. Database

`prisma/schema.prisma` defines: User, Organization, Membership, Shipment, Port, Document,
QuotationRequest, QuotationOffer, AuditLog, Company, CompanyService, CompanyDocument,
VerificationReview, Rfq, RfqRecipient, Quote, QuoteItem, BookingRequest, TrackingEvent.

Findings:
- No migration files exist (`prisma/migrations` absent).
- No seed data for ports, roles, or reference data.
- `BookingRequest` has **no unique constraint on `quoteId`** and no relation to `Quote`.
- Money is `Decimal` in the schema but handled as `number` in the application layer.
- `CompanyDocument` stores metadata only; there is no endpoint that persists a company file.

## 4. Frontend (`apps/web`)

18 routes. Arabic-first RTL. Session guard, cross-tab sync and identity display were added
in the previous pass.

| Route | Status |
|---|---|
| `/` | Implemented landing with session-aware header |
| `/login`, `/register` | Implemented, account-type selection |
| `/dashboard` | Minimal |
| `/shipments` | Implemented |
| `/rfqs`, `/rfqs/[id]` | Implemented list/detail, accept only — **no provider quote editor** |
| `/quotations`, `/quotations/[id]` | Implemented for the legacy domain |
| `/costs` | Implemented |
| `/documents` | Listing only — no upload |
| `/ai` | Copilot chat with honest fallback label |
| `/directory`, `/directory/[id]` | Implemented |
| `/company/register` | Implemented |
| `/admin` | Implemented |
| `/analytics` | Placeholder (explicitly labelled) |
| `/settings` | Placeholder (explicitly labelled) |

Design system: custom components in `components/ui` (Button, Card, Input, Badge, EmptyState).
shadcn/ui, Lucide, Motion, TanStack Query/Table are **not** installed.
Tailwind `slate` scale is partially overridden in `tailwind.config.js`.

## 5. AI service (`apps/ai-service`)

`main.py` exposes `/health`, `/landed-cost`, `/copilot/answer`, `/documents/validate`,
`/predict/delay`. All four AI endpoints are **placeholders**. No provider library is
imported, no environment variable is read, no model is loaded.

`.env.example` declares `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL`. **No source file reads any of them.** The only
occurrence is inside a fallback message string.

## 6. Features that are implemented but unverified

- Persistence behaviour across restarts (no database available).
- PostgreSQL-mode branches of every route (never executed).
- Prisma schema validity beyond `prisma generate`.

## 7. Regressions and risks found

1. **Critical** — `POST /bookings/:id/confirm` authorized any authenticated user. *(fixed in this pass)*
2. **High** — `POST /quotations/:id/offers` lets the requesting organization write offers onto its own request; no provider path exists.
3. **High** — `documents/:id/validate` calls the AI service without a request body, so no document can ever be processed.
4. **High** — Legacy `quotations` and new `rfq` domains coexist with overlapping concepts.
5. **Medium** — CORS `origin: true` reflects any origin.
6. **Medium** — Empty port list makes shipment creation unusable in database mode.
7. **Medium** — `logger: false` disables structured logging and request correlation.
8. **Low** — Dead packages duplicating validation and UI concerns.

## 8. Changes made after this audit

| Finding | Status |
|---|---|
| S1 — booking confirmation had no provider authorization | Fixed, 5 negative cases tested |
| S2 — legacy quotation offers writable by the customer | Fixed, tested |
| S5 — silent in-memory fallback in production | Fixed (fail-fast) |
| S7 — structured logging disabled | Fixed |
| No migrations | Two migrations committed and applied |
| No port seed | 20 ports seeded, idempotent |
| Empty port directory blocked shipments | Resolved; ports are seeded and shipments accept codes |
| No provider quotation UI | Added `/provider/rfqs` and `/provider/rfqs/[id]` |
| No booking decision UI | Added `/bookings` |
| Decimal/date shape differed between modes | Fixed with one serialisation hook |
| One role per user per organization | Fixed; unique key now includes the role |

Remaining: see `docs/feature-status.md` and `docs/security-review.md`.
