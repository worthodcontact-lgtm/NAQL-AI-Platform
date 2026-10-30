# Phase 4 API and workflow notes

Base path: `/api/v1`. Ordinary customer/provider endpoints require an application bearer token and applicable organization permission. `/admin/*` uses the separate platform-admin session and route permission checks.

## RFQ and quotation lifecycle

- `POST /rfqs`: creates a customer-owned RFQ; validates mode/cargo/weight and, when supplied, validates origin and destination against the port directory and requires the port pair and Incoterm together.
- `GET /rfqs`, `GET /rfqs/:id`: organization-scoped RFQ view. The detail response includes `viewerRole` (`owner`, `provider`, or `staff`), quote `company` summaries (`id`, `name`, `type`, `verificationStatus`), and owner-only `bookings` with the linked `shipmentId`/shipment status. Provider views omit owner bookings.
- `GET /rfqs/incoming`: only invitations addressed to companies owned by the authenticated provider organization.
- `POST /rfqs/:id/quotes`: provider offer; company ownership, invitation/eligibility, RFQ state, quote validity, currency and item constraints are checked. A provider may have one submitted quote at a time and may resubmit after withdrawal/expiry.
- `POST /rfqs/:id/quotes/:quoteId/withdraw`: provider-owned submitted quote withdrawal; history remains auditable.
- `POST /rfqs/:id/accept`: customer-only acceptance of one unexpired submitted quote. Transaction and database constraints protect the winner and create/reuse a booking. For RFQs with validated ports and Incoterm, it creates a shipment if one is not linked; an explicitly linked shipment must belong to the customer and match the route. The accepted provider receives party access. A repeated request returns the original booking.
- Booking decision routes record provider confirmation/rejection and customer cancellation rules; see `apps/api/src/rfq/routes.ts` for exact paths and payload schemas.

Statuses and allowed transitions are enforced in route/service logic. Acceptance is terminal for the RFQ winner; other active offers are rejected. Shipment events are validated by `apps/api/src/shipments/state.ts`, recorded with actor/source/time and idempotency key. Imported tracking remains unavailable unless a real carrier integration is configured.

## Other relevant endpoints

- `POST /shipments/:id/events`, `GET /shipments/:id/events`, `GET /shipments/:id/tracking`: manual/idempotent internal events and honest external availability.
- `POST /shipments/:id/documents`, `POST /documents/:id/process`, `GET /documents/:id/extraction`: guarded document upload and extraction.
- `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`: persistent in-app notifications; persistence is not external delivery.
- `POST /notifications/:id/retry-delivery`: explicit external-delivery attempt. It uses the notification ID as the provider idempotency key, records `externalDeliveryAttempts`/`externalDeliveryLastAttemptAt`, and reports `sent`, `failed`, or `provider_unavailable` without re-sending a previously delivered notification.
- `POST /costs/landed-cost`: calculator response includes `status: estimated`, `verified: false`, and per-component provenance/assumptions.
- `GET /admin/integrations`: platform-admin-only sanitized status registry; exposes no credentials or provider error bodies.
- `GET /health`, `GET /ready`: liveness/readiness checks. `GET /ready?detailed=1` adds sanitized dependency states for database, AI, PDF/OCR, object storage, and email. The admin registry remains the full diagnostics view.
- Company types accepted at registration include `importer_exporter`, `forwarder`, `carrier`, `shipping`, `air`, `customs`, and `warehouse`; registration is not equivalent to verification or operational integration.

See route schemas for required fields, precise status codes, and stable error codes. A `200` response alone does not indicate an external operation was performed.
