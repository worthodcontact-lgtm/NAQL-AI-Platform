# NAQL AI — Target Architecture

This document describes the intended shape of the platform. It builds on the existing
stack (pnpm + Turborepo, Next.js 14 App Router, Fastify 4, Prisma, Python FastAPI) and
does not propose a rewrite.

## Runtime topology

```
Browser (Next.js 14, RTL-first)
   |
   | REST /api/v1 (JWT bearer)
   v
Fastify API  ──────────────►  PostgreSQL (Prisma)
   |                             - tenant-scoped business data
   |                             - migrations committed to the repo
   |                             - idempotent seed for reference data
   |
   ├──► Object storage abstraction
   |      dev: local filesystem under STORAGE_PATH
   |      prod: S3-compatible
   |
   └──► AI service (FastAPI, optional)
          provider adapter -> Ollama | OpenAI-compatible | Anthropic
```

## Layering rules

1. **Routes** validate input (Zod), resolve the authenticated user, and delegate.
2. **Authorization** is resolved server-side from the JWT and the database. A client-supplied
   organization id, role, company id, or price is never trusted.
3. **Domain services** hold business rules that must be testable without HTTP
   (status machines, landed cost, rate comparison, retrieval scoping).
4. **Repositories** are Prisma queries. Tenant scoping is applied in the query, not after it.
5. **Adapters** isolate everything external: AI providers, mail, OCR, storage, maps, tracking.

## Data model direction

Consolidate rather than duplicate:

- `rfq` is the single quotation domain. The legacy `quotations` module is deprecated and its
  routes are replaced by RFQ equivalents; the old tables stay until data migration is approved.
- Adding: `notification`, `user_session`, `password_reset_token`, `ai_suggestion`,
  `rate_card`, `rate_component`, `data_source`, `customs_case`, `shipment_container`.
- Adding constraints: unique `BookingRequest.quoteId`, indexes on
  `(organizationId, createdAt)` for every tenant-scoped list, and on
  `(companyId, validFrom, validUntil)` for rates.

## State machines

| Entity | States |
|---|---|
| Shipment | DRAFT → QUOTATION_REQUESTED → QUOTED → BOOKED → IN_TRANSIT → ARRIVED → CUSTOMS_CLEARANCE → DELIVERED, plus CANCELLED / EXCEPTION |
| RFQ | submitted → awaiting_response → quoted → accepted → closed |
| Booking | requested → confirmed \| rejected \| cancelled |
| Company | draft → submitted → under_review → approved, plus needs_information / rejected / suspended |
| Verification | separate from the company lifecycle |

Every transition records the actor and a timestamp, and is written to the audit log.

## Persistence policy

- `NODE_ENV=production` **requires** a reachable database. The API refuses to start otherwise.
- Development without a database runs in an explicit, labelled fallback mode. Every response
  carries `devFallback: true` and the UI surfaces a visible banner. Fallback mode must never be
  silent, and must never be used for data the user believes is persisted.
- `/health` reports `persistenceMode: "database" | "memory"`.

## AI architecture

```
Route (tenant scoped)
  -> Domain retrieval (Prisma queries scoped to organizationId)
  -> Prompt assembly (facts + explicit uncertainty)
  -> Provider adapter (timeout, retry, budget, capability metadata)
  -> Response with: answer, evidence[], confidence?, providerAvailable, disclaimer
```

Rules:
- Retrieval happens **before** the model, and it is organization-scoped in the query.
- No model output is presented as an official customs, legal, or financial decision.
- Document AI stores extraction results with provenance and requires human approval.
- When no provider is configured, endpoints return `providerAvailable: false` — never a fabricated answer.

## Frontend architecture

- Server components by default; client components only for interaction.
- Server state via TanStack Query once multiple consumers share a resource.
- Forms via React Hook Form + Zod using schemas from `packages/validation`.
- Locale routing (`/ar`, `/en`) with a single message catalogue; identifiers (tracking numbers,
  container ids, company legal names) are never translated.
- Design tokens centralised in Tailwind config; components in `components/ui` only.

## Non-goals

- Docker as a development requirement.
- Live carrier tracking, GPS, payment, or customs-system integration without a real contract.
- Vector search before simple scoped queries are proven insufficient.
