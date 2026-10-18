# NAQL AI — Architecture

## Layers
- `apps/web`: Next.js App Router frontend, Arabic-first RTL with reusable components.
- `apps/api`: Fastify + TypeScript API, Prisma ORM, PostgreSQL/PostGIS, tenant isolation.
- `apps/ai-service`: FastAPI AI service (copilot, document validation, delay interface).
- `packages/shared-types`, `packages/validation`, `packages/ui`, `packages/config`.

## Domain boundaries
- Identity: users, organizations, memberships, roles.
- Company directory: companies, services, locations, documents, verification reviews.
- Logistics: shipments, shipment items, milestones, documents.
- Commercial: RFQs, quotations, quote items, bookings, tracking events.
- Market data: sources, observations, rate cards, collection runs.
- Customs: clearance cases, events, expenses.
- Governance: audit logs, admin oversight, integrations.

## Security model
- JWT contains user id, organization id, roles.
- Every protected endpoint resolves the caller's organization server-side; resource ownership is enforced per record.
- Client-supplied organization ids, roles, or permissions are never trusted.
- Verification authority is separated from company management.

## Data and API standards
- Explicit relational models with foreign keys, unique constraints, and indexes.
- Decimal-safe money, stored currency codes, timestamps in UTC.
- REST under `/api/v1`, validation with Zod, consistent error responses.
- Health checks, structured logging, rate limiting.

## Honest integration states
- External provider integrations expose connection status and fallbacks.
- Collected prices carry source, currency, unit, and validity state.
- Unavailable features are labeled rather than simulated.
