# PHASE 3 API — Documents, Quotations, Bookings, Tracking, Notifications

All routes are under `/api/v1`. Unless explicitly marked public, requests require:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Tenant context always comes from the authenticated principal. **No Phase 3 endpoint accepts a client-supplied `organizationId` for authorization.** A permission check alone is not enough where shipment party access applies; the route also calls `loadShipmentAccess`.

---

## 1. Common error behavior

| HTTP | Meaning |
|---|---|
| `400` | Invalid input, bad base64, size mismatch, future timestamp, invalid transition payload |
| `401` | Missing/invalid token |
| `403` | Authenticated but not permitted, or quarantined document |
| `404` | Missing record or an inaccessible record from another tenant |
| `409` | State conflict: expired quote, already accepted, invalid transition, duplicate decision |
| `413` | Decoded payload above the configured limit |
| `415` | Unsupported content type, verified by content and extension |
| `422` | Malware detected by a configured scanner |
| `503` | Database/storage/scanner/provider/integration unavailable |

Errors use a stable `code` where the client needs to branch:

```json
{ "error": "Human-readable message", "code": "stable_code" }
```

---

## 2. Permission summary

| Operation | Company permission | Additional check |
|---|---|---|
| Upload shipment document | `shipments.documents.upload` | `loadShipmentAccess` + `uploadDocument` |
| List/read shipment documents | `shipments.documents.read` | `loadShipmentAccess` + `viewDocuments` |
| Download document bytes | `shipments.documents.read` | visibility and party access |
| Process document | `shipments.documents.upload` | shipment/document access |
| Upload company verification document | `company.documents.manage` | company belongs to the organization |
| Read company verification document | `company.documents.read` | company belongs to the organization |
| Withdraw quote | `quotes.submit` | owning provider company |
| Accept quote | `quotes.accept` | RFQ owner organization |
| Record manual shipment event | `shipments.update` | `loadShipmentAccess` + `updateStatus` |
| Read shipment events/tracking | `shipments.read` | `loadShipmentAccess` |
| Read notifications | authenticated session | user + organization scope |
| Confirm/reject booking | `bookings.confirm` | provider owning the accepted quote, or platform staff with booking permission |
| Cancel booking | `bookings.read` | customer, provider, or platform staff |
| Admin document evidence | `companies.documents.read` | platform staff + mandatory reason |

---

## 3. Shipment documents

### 3.1 Upload

```http
POST /api/v1/shipments/:id/documents
```

```json
{
  "type": "invoice",
  "filename": "invoice-1001.pdf",
  "contentType": "application/pdf",
  "size": 58214,
  "visibility": "shipment",
  "dataBase64": "<base64>"
}
```

- `type`: display/classification value such as `invoice`, `packing_list`, `bill_of_lading`, `customs_document`.
- `filename`: display metadata only; path components are rejected or stripped safely.
- `size`: must equal the decoded byte length.
- `visibility`: `shipment` (default) or `private`.
- `dataBase64`: omitted only for a legacy metadata-only row; such a row cannot be downloaded or processed.

Allowed content types:

| MIME | Extensions |
|---|---|
| `application/pdf` | `.pdf` |
| `image/png` | `.png` |
| `image/jpeg` | `.jpg`, `.jpeg` |
| `text/csv` | `.csv` |
| `application/json` | `.json` |
| `application/xml` | `.xml` |
| `text/plain` | `.txt` |

The server validates declared MIME, filename extension, and magic bytes. Text-like files are checked for NUL/implausible control bytes.

Response: document view. **No `storageKey` or public URL is returned.**

```json
{
  "id": "cm...",
  "shipmentId": "cm...",
  "type": "invoice",
  "filename": "invoice-1001.pdf",
  "contentType": "application/pdf",
  "size": 58214,
  "visibility": "shipment",
  "status": "uploaded",
  "malwareScanStatus": "not_scanned",
  "contentHash": "<sha256>",
  "retentionUntil": null,
  "deletedAt": null,
  "hasContent": true,
  "processingStatus": null,
  "uploadedAt": "2026-10-21T..."
}
```

Upload errors include `unsupported_content_type`, `invalid_base64`, `content_type_mismatch`, `extension_mismatch`, `signature_mismatch`, `file_too_large`, `malware_detected`, `malware_scan_unavailable`, and `storage_unavailable`.

A length mismatch returns `400`; decoded bytes above `MAX_DOCUMENT_BYTES` return `413`.

### 3.2 List

```http
GET /api/v1/documents
GET /api/v1/documents?shipmentId=<id>
```

Returns only documents the caller can see. With `shipmentId`, the caller must have `viewDocuments` on that shipment. Without it, the route collects accessible shipments first, then filters `shipment`/`private` visibility.

Response:

```json
{ "items": [ { "...": "document view, optionally with shipment summary" } ] }
```

Soft-deleted rows are excluded. The repository maintains a no-database development fallback; production and integration tests use PostgreSQL.

### 3.3 Detail

```http
GET /api/v1/documents/:id
```

Applies shipment access, visibility, deletion, and quarantine checks. Returns the document view.

### 3.4 Download bytes

```http
GET /api/v1/documents/:id/content
```

Returns the stored bytes with:

```http
Content-Type: <stored content type>
Content-Disposition: attachment; filename="..."
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

- No public/static path is exposed.
- A `private` document is not visible to other shipment parties.
- Infected, deleted, missing-byte, and metadata-only documents are refused.
- Successful downloads record an audit event.
- Cross-organization access returns `404`, not a document existence leak.

### 3.5 Process

```http
POST /api/v1/documents/:id/process
```

Idempotent processing. Response statuses:

| `status` | Meaning |
|---|---|
| `completed` | Extraction completed; fields are included |
| `unavailable` | No extractor/OCR/provider available; explicit warnings |
| `failed` | Extraction failed; safe error details |
| `processing` | Another run owns a current lease; retry later |

If a document is already being processed, the endpoint does not start a second run.

### 3.6 Extraction

```http
GET /api/v1/documents/:id/extraction
```

Returns persisted extractor provenance, method, OCR status, warnings, fields, and findings. `404 extraction_not_available` means no successful/processed row exists yet.

### 3.7 Legacy validate alias

```http
POST /api/v1/documents/:id/validate
```

Retained for Phase 2 clients; delegates to the same processing path. New clients should use `/process`.

### 3.8 Consistency

```http
POST /api/v1/shipments/:id/consistency
GET /api/v1/shipments/:id/consistency
```

Runs deterministic document/shipment rules, persists findings per organization, and returns:

```json
{
  "shipmentId": "cm...",
  "ruleVersion": "consistency-v1-...",
  "documentsChecked": 3,
  "findings": [
    {
      "id": "cm...",
      "code": "INVOICE_TOTAL_MISMATCH",
      "severity": "ERROR",
      "field": "total",
      "observed": "1200 USD",
      "expected": "1250 USD",
      "message": "...",
      "suggestedAction": "...",
      "requiresReview": true
    }
  ]
}
```

POST may create `DOCUMENT_FINDINGS` notifications for ERROR/CRITICAL findings. Findings are indicators for human review, not customs/legal decisions.

---

## 4. Company verification documents

### 4.1 Upload

```http
POST /api/v1/companies/:id/documents
```

```json
{
  "type": "commercial_register",
  "filename": "commercial-register.pdf",
  "contentType": "application/pdf",
  "size": 120000,
  "dataBase64": "<base64>"
}
```

`type`: `commercial_register`, `tax_card`, `license`, `insurance`, `other`.

Only PDF/PNG/JPEG bytes that pass signature validation are accepted. Bytes are mandatory. The server generates the storage key; a client `storageKey` is not accepted.

Response: company document view with `contentHash`, `malwareScanStatus`, `retentionUntil`, `status`, `reviewNote`, and `hasContent`. No storage key.

### 4.2 List

```http
GET /api/v1/companies/:id/documents
```

Only for a company owned by the authenticated organization.

### 4.3 Download

```http
GET /api/v1/companies/:id/documents/:documentId/content
```

Company-owned access only, with quarantine/deletion checks and audit logging.

### 4.4 Staff evidence access

```http
GET /api/v1/admin/companies/:id/documents
GET /api/v1/admin/companies/:id/documents/:documentId/content?reason=<required>
```

Requires platform permissions `companies.read` / `companies.documents.read`. The admin content route requires a non-empty reason and records the reason in the audit log.

---

## 5. Quotations

### 5.1 Submit quote

```http
POST /api/v1/rfqs/:id/quotes
```

```json
{
  "companyId": "cm...",
  "currency": "USD",
  "transitDays": 12,
  "validityUntil": "2026-10-28T12:00:00.000Z",
  "items": [
    { "label": "Ocean freight", "amount": 1200, "currency": "USD", "included": true }
  ]
}
```

Rules:

- RFQ must exist, be open, and have invited the provider company.
- Currency is a three-letter uppercase ISO code.
- Item currencies must equal the quote currency.
- Amounts must be positive; quantities/prices are validated.
- The total is computed by the server from included items.
- Expired/closed RFQs are rejected.
- Creates `QUOTATION_RECEIVED` notifications for the RFQ owner.

### 5.2 Withdraw quote

```http
POST /api/v1/rfqs/:id/quotes/:quoteId/withdraw
```

No body is required. Only the owning provider company with `quotes.submit` may withdraw.

- Submitted quote → `withdrawn` with `withdrawnAt`, `decidedAt`, `decidedByUserId`.
- Accepted quote → `409 quote_already_accepted`.
- Withdrawn quote → `200` with `alreadyWithdrawn: true`.
- Other states → `409 quote_not_withdrawable`.
- Creates `QUOTATION_WITHDRAWN` notifications.
- A withdrawn quote is rejected by acceptance.

### 5.3 Accept quote

```http
POST /api/v1/rfqs/:id/accept
```

```json
{ "quoteId": "cm...", "shipmentId": "cm..." }
```

`shipmentId` is optional. If supplied, it must belong to the authenticated customer organization and must not be `DELIVERED` or `CANCELLED`; the booking then stores the link. If omitted, the booking still references the accepted quote.

Success (first acceptance) returns the created `BookingRequest`:

```json
{
  "id": "<booking id>",
  "rfqId": "cm...",
  "quoteId": "cm...",
  "shipmentId": "cm...",
  "organizationId": "cm...",
  "createdByUserId": "cm...",
  "status": "requested",
  "createdAt": "2026-10-21T...",
  "updatedAt": "2026-10-21T...",
  "alreadyAccepted": false
}
```

Retry of the same quote:

```http
200
{ "...": "existing booking fields", "alreadyAccepted": true }
```

Conflict cases:

| Code | Meaning |
|---|---|
| `rfq_not_open` | RFQ no longer open |
| `quote_not_found` | Quote not in this RFQ |
| `quote_expired` | `validityUntil` has passed |
| `quote_not_acceptable` | Withdrawn/rejected/not submitted |
| `quotation_already_accepted` | A different quote already won |
| `shipment_not_found` | Supplied shipment is not owned by the caller |
| `shipment_closed` | Supplied shipment is delivered/cancelled |

The acceptance and booking creation occur in one transaction under a PostgreSQL advisory lock. Partial unique indexes provide a second guarantee. Losing quotes are rejected with actor/reason/time. `QUOTATION_ACCEPTED` / `QUOTATION_REJECTED` notifications are emitted after commit.

### 5.4 Quotation request offers

The separate Phase 2 `QuotationRequest` flow (`/api/v1/quotations/...`) also supports award/reject/withdraw with:

- transactional award;
- expiry and currency validation;
- one awarded offer per request (partial unique index);
- `QUOTATION_ACCEPTED` / `QUOTATION_REJECTED` notifications;
- cross-organization denial.

---

## 6. Bookings

### 6.1 Confirm

```http
POST /api/v1/bookings/:id/confirm
{ "externalReference": "BKG-2026-001" }
```

- Provider company or platform staff with booking permission only.
- Provider reference is required for confirmation.
- Records actor/time/reference and a `BOOKING_CONFIRMED` notification.
- Repeating a decision returns `409 booking_already_decided`; it does not silently overwrite.

### 6.2 Reject

```http
POST /api/v1/bookings/:id/reject
{ "reason": "No vessel space on the requested date" }
```

Reason is required; actor/time/reason are stored. Creates `BOOKING_REJECTED`.

### 6.3 Cancel

```http
POST /api/v1/bookings/:id/cancel
{ "reason": "Customer cancelled the order" }
```

Requires `bookings.read`; customer, provider, or platform staff may cancel if they have authority. Reason, actor, and time are stored. Creates `BOOKING_CANCELLED`.

### 6.4 Manual booking tracking (legacy)

```http
POST /api/v1/bookings/:id/tracking
{ "code": "CARGO_RECEIVED", "label": "Entered terminal" }
```

Codes are now validated against the shipment event definitions. Arbitrary free-text codes are rejected. New integrations should use shipment events.

---

## 7. Shipment events and tracking

### 7.1 List events

```http
GET /api/v1/shipments/:id/events
```

```json
{
  "shipmentId": "cm...",
  "status": "IN_TRANSIT",
  "items": [
    {
      "id": "cm...",
      "code": "DEPARTED",
      "label": "Shipment departed",
      "occurredAt": "2026-10-21T...",
      "recordedAt": "2026-10-21T...",
      "source": "manual-customer",
      "actorUserId": "cm...",
      "actorOrganizationId": "cm...",
      "note": null,
      "metadata": null,
      "idempotencyKey": "..."
    }
  ]
}
```

Events are ordered by `occurredAt`, then `recordedAt`.

### 7.2 Record manual event

```http
POST /api/v1/shipments/:id/events
{ "code": "DEPARTED", "idempotencyKey": "manual-2026-10-21-001" }
```

Allowed codes: `BOOKING_CONFIRMED`, `CARGO_RECEIVED`, `DEPARTED`, `IN_TRANSIT`, `ARRIVED`, `CUSTOMS_PROCESSING`, `CARGO_RELEASED`, `DELIVERED`, `DELAYED`, `CANCELLED`.

Optional fields: `label`, `occurredAt` (ISO), `note` (max 1000), `metadata`, `source`.

`source` defaults to `manual`. The route resolves the actual stored source to `manual-customer` or `manual-provider`; client-provided source values are not trusted for attribution.

Responses:

- `200` new event, `idempotent: false`;
- `200` duplicate idempotency key, `idempotent: true`, same event;
- `400 future_event_timestamp`;
- `400 event_before_shipment`;
- `409 invalid_shipment_transition`;
- `403 insufficient_company_permission`;
- `404` for an inaccessible shipment.

Manual events create `SHIPMENT_MILESTONE` notifications; `DELAYED` creates a `RISK_ALERT`.

### 7.3 Live-tracking boundary

```http
GET /api/v1/shipments/:id/tracking
```

Returns recorded events plus:

```json
{
  "liveTracking": {
    "available": false,
    "code": "live_tracking_unavailable",
    "reason": "No carrier, AIS, port or customs integration is configured. Locations and carrier status are not inferred."
  }
}
```

Attempting to submit `source: "imported"` or `source: "external_verified"`:

```http
503
{
  "error": "No live or imported tracking integration is configured",
  "code": "live_tracking_integration_unavailable",
  "guidance": "Only manually entered milestone events can be recorded..."
}
```

No GPS, vessel, port congestion, customs status, or ETA is fabricated.

---

## 8. Notifications

### 8.1 List

```http
GET /api/v1/notifications?page=1&limit=20&unreadOnly=true
```

`page`: 1–1000. `limit`: 1–50. `unreadOnly`: `true`/`false`.

```json
{
  "items": [
    {
      "id": "cm...",
      "type": "QUOTATION_ACCEPTED",
      "title": "تم قبول عرض السعر",
      "body": "...",
      "severity": "info",
      "entityType": "BookingRequest",
      "entityId": "cm...",
      "read": false,
      "readAt": null,
      "deliveryStatus": "persisted",
      "externalDeliveryStatus": "provider_unavailable",
      "createdAt": "2026-10-21T..."
    }
  ],
  "total": 4,
  "unreadCount": 2,
  "page": 1,
  "limit": 20,
  "hasMore": false,
  "externalDelivery": {
    "provider": "none",
    "configured": false,
    "status": "provider_unavailable"
  }
}
```

Notifications are scoped by both `userId` and `organizationId`.

Types: `QUOTATION_RECEIVED`, `QUOTATION_ACCEPTED`, `QUOTATION_REJECTED`, `QUOTATION_WITHDRAWN`, `BOOKING_CONFIRMED`, `BOOKING_REJECTED`, `BOOKING_CANCELLED`, `DOCUMENT_FINDINGS`, `DOCUMENT_UPLOADED`, `SHIPMENT_MILESTONE`, `RISK_ALERT`.

### 8.2 Mark one read

```http
PATCH /api/v1/notifications/:id/read
```

Idempotent; keeps the original `readAt` if already read.

### 8.3 Mark all read

```http
POST /api/v1/notifications/read-all
{ "updated": 3 }
```

### 8.4 Retry external delivery

```http
POST /api/v1/notifications/:id/retry-delivery
```

Without a configured provider:

```http
503
{
  "error": "No external notification provider is configured",
  "code": "notification_provider_unavailable",
  "inAppPersisted": true
}
```

Persisted in-app notifications are never reported as externally delivered.

---

## 9. Intelligence and risk

```http
GET  /api/v1/shipments/:id/intelligence
POST /api/v1/shipments/:id/intelligence/refresh
GET  /api/v1/shipments/:id/intelligence/history
```

- Risk/delay are deterministic indicators from recorded data.
- Delay is `insufficient_data` when no planned ETA exists; no delay days are invented.
- Refresh persists a new assessment and creates a `RISK_ALERT` notification for high/critical risk (deduplicated per shipment/rule version/category).
- The response includes explicit limitations about missing live weather, congestion, carrier, and customs feeds.

---

## 10. Compatibility notes

- Existing Phase 1/2 routes remain available.
- Metadata-only document records remain readable as metadata but cannot be downloaded/processed.
- Legacy tracking codes must be replaced by the documented event codes.
- A withdrawn quote cannot be re-submitted for the same company/RFQ because the existing unique reservation remains.
- The optional `shipmentId` on acceptance is the only booking–shipment link; the RFQ model itself has no shipment field.
