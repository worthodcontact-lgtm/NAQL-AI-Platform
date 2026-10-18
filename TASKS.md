# NAQL AI — Tasks

## Phase 1 — Foundation, audit, auth
- [x] Monorepo scaffold (pnpm + Turborepo)
- [x] JWT auth, organization context, `/auth/me`
- [x] Session guard, cross-tab sync, 401 handling, and explicit identity display
- [x] Account-type selection at registration (development-only role hint)
- [x] Tenant isolation for shipments, quotations, documents
- [x] Architecture, roadmap, and UI design system docs
- [ ] Full permission matrix metadata for every route
- [ ] shadcn/ui + Motion adoption (evaluated; current custom components preserved)

## Phase 2 — Company directory, verification, admin
- [x] Company + service + document + verification models
- [x] Company registration, submit, directory, owner listing
- [x] Reviewer approve / reject / needs-information with audit
- [x] Public directory and company detail pages
- [x] Company registration page and admin console page
- [ ] Company document upload UI + reviewer checklist
- [ ] Organization member and invitation management

## Phase 3 — Rates and ingestion
- [ ] Source registry, collection jobs, runs, retries, dedup
- [ ] Spreadsheet import with row-level validation
- [ ] Price provenance and validity states

## Phase 4 — RFQ, quote, booking
- [x] RFQ, recipient, quote, quote-item, booking-request, tracking-event models
- [x] RFQ create/list/detail, quote submit, accept, booking confirm/tracking
- [x] RFQ list and detail frontend pages
- [ ] Provider portal quote editor
- [ ] Comparison table and expiry handling in UI

## Phase 5 — Customs portal
- [ ] Clearance cases, milestones, documents, expense records

## Phase 6 — Carrier and warehouse
- [ ] Capacity/services, transport orders, warehouse milestones

## Phase 7 — AI
- [x] Copilot, document validation, delay interfaces with fallback labeling
- [ ] HS suggestions with reviewer workflow
- [ ] Landed-cost component states with provenance

## Phase 8 — Quality
- [x] Unit + integration tests (16 passing)
- [x] API/web type checks and production builds
- [x] Session guard, cross-tab sync, and 401 handling
- [ ] Core Web Vitals measurement
- [ ] Accessibility audit of critical flows
- [ ] PostgreSQL-backed integration tests in CI
