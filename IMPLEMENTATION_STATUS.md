# NAQL AI — Implementation Status

## Completed in this pass
- Audit and documentation: `docs/architecture.md`, `docs/implementation-roadmap.md`, `docs/ui-design-system.md`, `docs/frontend-audit.md`.
- Database schema extended with Company, CompanyService, CompanyDocument, VerificationReview, Rfq, RfqRecipient, Quote, QuoteItem, BookingRequest, TrackingEvent, plus AuditLog metadata.
- API modules added: companies (register/submit/directory/detail/documents/admin verify), RFQ/quote/booking workflow, admin overview/companies/audit.
- Audit logging for company registration, submission, verification, quote submission, and booking actions.
- Platform staff authorization separated from company management; non-staff verification returns 403; reviewer-only approval verified by tests.
- Booking requests remain `requested` until a provider confirmation sets `confirmed` with an external reference.
- Frontend pages added: public company directory and detail, RFQ list/detail, company registration, admin console; app shell updated with RFQ, directory, and staff-only admin navigation.
- Tests added for company directory/verification and RFQ/quote/booking workflow.

## Session and identity pass
- Root `AuthProvider` holds session state and syncs across browser tabs (`storage` event + custom auth event).
- `RequireAuth` guard on the `(app)` route group redirects unauthenticated visitors to `/login?next=...` instead of rendering empty pages.
- `apiFetch` handles HTTP 401 centrally: clears the session and redirects to `/login?expired=1`.
- JWT payload decoding fixed for base64url (padding) in `lib/auth.ts`.
- `PublicHeader` on the public site now reflects the session (logged-in badge + "مساحة العمل"), fixing the misleading "تسجيل الدخول" that appeared in every tab.
- Identity is now explicit everywhere: account kind (عميل / شركة / موظف منصة), portal name, roles, display name, email, and organization ID.
- `accountType` selection added to registration; roles are mapped server-side and the explicit hint is honored only when `NODE_ENV !== "production"`.
- Mobile navigation added (horizontal link strip) because the sidebar is hidden below `lg`.

## Verification
- API typecheck: pass
- API tests: 16/16 passing (3 files)
- API production build: pass
- Web typecheck: pass
- Web production build: pass — 18 routes (verified with `NEXT_DIST_DIR=.next-verify` so it did not collide with the running dev server)

## Build environment note
- `next build` and `next dev` share the `.next` folder. Running a build while the dev server is running corrupts the build and produces
  `PageNotFoundError: Cannot find module for page: /...`. Stop the dev server first, or build with a separate output folder:
  `$env:NEXT_DIST_DIR=".next-verify"; pnpm --filter @naql/web build`
- Added `apps/web/next.config.mjs` with a `distDir` override for exactly this case. Default behaviour is unchanged.

## Remaining limitations
- PostgreSQL/PostGIS not installed locally; dev fallback used for persistent workflows.
- Rate ingestion, spreadsheet import, customs portal, carrier/warehouse modules, and HS suggestions are not implemented.
- shadcn/ui and Motion are documented as the target design stack; current implementation uses a compatible custom component layer.
- Core Web Vitals and accessibility audits not yet measured.

## Next implementation task
Implement rate cards and source provenance: `data_sources`, `rate_cards`, `rate_components`, `rate_observations`, with CSV import validation, row-level error reporting, and a price comparison view that respects validity, source, and price category.
