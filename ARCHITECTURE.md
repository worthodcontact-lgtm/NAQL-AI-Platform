# NAQL AI — Architecture

## Overview
Modular monorepo (pnpm + Turborepo) with:
- `apps/web`: Next.js (App Router, TS strict, Tailwind, RTL Arabic-first)
- `apps/api`: Node.js + Fastify + Prisma + PostgreSQL/PostGIS
- `apps/ai-service`: Python + FastAPI
- `packages/shared-types`, `packages/validation`, `packages/ui`, `packages/config`
- `infrastructure`: DB scripts
- `docs`: architecture/API/development

## Domain modules
Auth/orgs/RBAC; customers/providers; ports/locations/routes; shipments/cargo/containers/milestones; freight rates/quotes/offers; booking; landed cost; documents/validation; HS assistance; AI assistant; risk/delay; notifications; analytics; audit; integration adapters.

## Data & API standards
Prisma migrations, PostGIS, decimal money, consistent timestamps, pagination/filtering, OpenAPI, health checks, structured logging, env secrets, rate limiting, audit logs.

## Local dev
Avoid Docker for basic dev. Native PostgreSQL/Redis optional. AI providers configurable with labeled fallbacks.
