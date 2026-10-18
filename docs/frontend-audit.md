# NAQL AI — Frontend Audit

## Existing pages
- `/` landing (basic)
- `/login` functional JWT login
- `/dashboard` minimal metrics using API health/shipments
- `/shipments` validated creation + loading/error states
- `/costs` landed-cost form + result

## Missing pages/components
- Register page
- Authenticated application shell/sidebar/topbar
- Shipment details and lifecycle UI
- Quotations list/create/details/offers/award
- Documents center and AI validation UI
- AI copilot chat UI
- Analytics/map/settings honest unavailable states
- Shared design system (tokens, buttons, forms, dialogs, tables, toasts)

## Integration gaps
- No centralized typed API client; pages call fetch directly.
- No common loading/empty/error/forbidden handling.
- Preview states mostly direct; limited reusable components.
- Navigation duplicates routes.

## Decisions
- Keep Next.js App Router 14 and Tailwind.
- Add Cairo font and NAQL design tokens.
- Implement reusable client components in `apps/web/components`.
- Preserve API base URL via `NEXT_PUBLIC_API_URL`.
- Honest fallback labeling for preview/development-only behavior.
