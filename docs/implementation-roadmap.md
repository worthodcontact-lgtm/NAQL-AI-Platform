# NAQL AI — Implementation Roadmap

## Phase 1 — Repository audit, architecture, design tokens, auth, permissions
- [x] Existing monorepo, API, AI service, and web skeleton inspected
- [x] Architecture and roadmap documented
- [x] JWT auth and organization context
- [ ] Full permission matrix and route-level permission metadata
- [ ] Design tokens for shadcn/ui + Motion migration (in progress)

## Phase 2 — Company directory, organizations, registration, verification, admin review
- [x] Company domain models (schema + API + dev fallback)
- [x] Company registration and directory listing
- [x] Verification review workflow with admin authority
- [x] Public directory and company detail pages
- [x] Company registration page
- [x] Admin oversight page
- [ ] Company documents upload and reviewer checklist UI
- [ ] Organization members and invitation management

## Phase 3 — Services, routes, rate cards, ingestion, provenance
- [x] Rate/quote line-item foundations
- [ ] Source registry, collection jobs, retries, dedup
- [ ] Spreadsheet import validation and row-level errors

## Phase 4 — Shipment requests, RFQs, quotations, comparison, booking requests
- [x] Shipment creation and tenant isolation
- [x] RFQ, quote, quote item models and API
- [x] Booking request that stays unconfirmed until trusted confirmation
- [ ] Frontend RFQ wizard and comparison table
- [ ] Provider portal for responding to RFQs

## Phase 5 — Customs portal
- [ ] Clearance cases, milestones, documents, expenses

## Phase 6 — Carrier and warehouse workflows
- [ ] Capacity/services, transport orders, warehouse milestones

## Phase 7 — AI interfaces
- [x] Copilot, document validation, delay interfaces with fallbacks
- [ ] HS suggestions with review workflow
- [ ] Landed-cost transparency with component states

## Phase 8 — Polish, performance, security, accessibility, regression tests
- [ ] Measure Core Web Vitals
- [ ] Accessibility audit of critical flows
- [ ] Broaden automated test coverage
