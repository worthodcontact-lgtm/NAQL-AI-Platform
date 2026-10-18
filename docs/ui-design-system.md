# NAQL AI — UI Design System

## Brand
- Enterprise logistics, control-tower clarity, AI-assisted decision making.
- Slogan: PLAN — PREDICT — OPTIMIZE.

## Tokens
- Navy `#0B1220`, primary `#2563EB`, teal `#14B8A6`, canvas `#F5F7FB`, surface `#FFFFFF`.
- Text `#111827`, secondary `#64748B`, borders `#E2E8F0`.
- Semantic: success `#16A34A`, warning `#D97706`, error `#DC2626`.

## Typography
- Arabic: Cairo / IBM Plex Sans Arabic via `next/font`.
- Latin: system sans fallback aligned to the same scale.
- Scales: page title, section title, label, body, metadata.

## Components
- Buttons, inputs, selects, textareas, date inputs, validation messages.
- Cards, panels, tables, badges, tabs, dropdowns, dialogs, drawers.
- Search and filters, pagination, breadcrumbs.
- Empty, loading skeleton, error, success states; confirmation dialogs; toasts.
- Logistics-specific: shipment summary, route/milestone timeline, price comparison table, quotation line-item editor, audit viewer.

## RTL and i18n
- Arabic default with `dir="rtl"` at the document level.
- Logical CSS properties; only directional icons mirror.
- LTR content (emails, IDs, tracking numbers, currencies) uses `.ltr-text`.
- Structure supports a future English locale without rewriting.

## Motion
- CSS transitions for hover/focus (150–250 ms).
- Motion for page/menu/modal transitions only.
- Reduced-motion respected; no continuous animation on operational data.

## Performance budgets
- LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 once measured. Not yet measured.
