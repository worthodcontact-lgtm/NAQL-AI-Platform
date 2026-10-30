# PHASE 2 API — Document AI & Intelligence

All routes are under `/api/v1` and require `Authorization: Bearer <accessToken>` unless stated otherwise. The API derives the tenant from the authenticated principal. **No endpoint accepts a client-supplied `organizationId` for tenant context.**

---

## 1. Common behavior

### Authentication and permissions

| Area | Required company permission |
|---|---|
| Shipment document upload | `shipments.documents.upload` |
| Document list/detail/extraction | `shipments.documents.read` |
| Document processing | `shipments.documents.upload` |
| Consistency | `shipments.documents.read` |
| Shipment intelligence | `shipments.read` |
| Copilot/retrieval | authenticated session; shipment access is re-checked |

A user must still pass `loadShipmentAccess`. Being authenticated or holding a permission is not enough to read another organization's shipment.

### Errors

| HTTP | Meaning |
|---|---|
| `400` | Invalid input, invalid base64, size mismatch, legacy delay request without `shipmentId` |
| `403` | Authenticated but not permitted |
| `404` | Shipment/document/conversation not found or outside tenant scope |
| `413` | Payload larger than 2 MB |
| `415` | Unsupported MIME type, extension mismatch or content-signature mismatch |
| `503` | Database required for this operation, or processing/retrieval unavailable |

Validation failures include `error` and usually a stable `code`, for example:

```json
{
  "error": "File content does not match the declared type",
  "code": "content_signature_mismatch"
}
```

Document upload validation codes:

- `invalid_base64`
- `empty_file`
- `unsupported_content_type`
- `extension_content_type_mismatch`
- `content_signature_mismatch`
- `invalid_filename`
- `invalid_storage_key`

---

## 2. Documents

### 2.1 Upload a shipment document

`POST /api/v1/shipments/:id/documents`

Permission: `shipments.documents.upload` plus shipment access.

Request:

```json
{
  "type": "invoice",
  "filename": "invoice-2026-001.pdf",
  "contentType": "application/pdf",
  "size": 12345,
  "visibility": "shipment",
  "dataBase64": "JVBERi0xLjQK..."
}
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | Business label, e.g. `invoice`, `packing_list`, `bill_of_lading`, `certificate_of_origin`, `customs`. |
| `filename` | yes | Display name only. Path separators and traversal names are rejected. |
| `contentType` | yes | Must be one of the supported MIME types. |
| `size` | yes | Positive integer, maximum 2 MB. Must equal decoded payload length. |
| `visibility` | no | `shipment` (default) or `private`. |
| `dataBase64` | no | Standard base64. If omitted, the record is stored as `metadata_only` and later processing fails explicitly. |

Allowed types: `application/pdf`, `image/png`, `image/jpeg`, `text/csv`, `application/json`, `application/xml`, `text/plain`.

The server:

1. Sanitizes the display filename.
2. Generates a storage key under `shipments/{shipmentId}/documents/`.
3. Decodes and size-checks the payload.
4. Checks the declared MIME type, filename extension and content signature.
5. Stores bytes through the storage adapter.
6. Creates a `Document` with `uploadedByUserId` and `uploadedByOrganizationId`.

Response `200`:

```json
{
  "id": "doc_...",
  "shipmentId": "shp_...",
  "type": "invoice",
  "filename": "invoice-2026-001.pdf",
  "contentType": "application/pdf",
  "size": 12345,
  "visibility": "shipment",
  "status": "uploaded",
  "validation": null,
  "processingStatus": null,
  "uploadedAt": "2026-10-21T10:00:00.000Z"
}
```

`storageKey` and uploader identifiers are never returned.

### 2.2 List documents

`GET /api/v1/documents?shipmentId=<id>`

Permission: `shipments.documents.read`.

- With `shipmentId`, returns authorized documents for that shipment.
- Without `shipmentId`, returns documents from all shipments visible to the principal.
- Party users see `visibility: "shipment"` documents plus their own `private` documents.
- Owners see all documents on their shipments.
- Maximum 200 rows per request. There is no pagination cursor yet.

Response:

```json
{
  "items": [
    {
      "id": "doc_...",
      "shipmentId": "shp_...",
      "type": "invoice",
      "filename": "invoice.pdf",
      "contentType": "application/pdf",
      "size": 12345,
      "visibility": "shipment",
      "status": "processed",
      "validation": {},
      "processingStatus": "completed",
      "uploadedAt": "2026-10-21T10:00:00.000Z"
    }
  ]
}
```

### 2.3 Get one document

`GET /api/v1/documents/:id`

Returns the same safe view as the list. Does not return file bytes, storage keys or extracted text.

`404` is used for a document outside the caller's scope, including a private document uploaded by another party.

### 2.4 Process a document

`POST /api/v1/documents/:id/process`

Permission: `shipments.documents.upload` plus shipment access. Party users may process only their own uploads; the shipment owner may process any authorized document.

This is a synchronous operation. A database is required; without one the route returns `503 database_required`.

Behavior:

1. Upserts `DocumentExtraction` with `status: "processing"`.
2. Reads the stored bytes through the storage adapter.
3. Decodes text or calls the optional Python service for PDF/OCR.
4. Runs deterministic classification/field extraction.
5. Optionally calls the configured AI provider for enrichment.
6. Persists the result and updates `Document.status`.

Response `200`:

```json
{
  "documentId": "doc_...",
  "status": "completed",
  "documentType": "commercial_invoice",
  "extractionMethod": "deterministic-text-v1",
  "ocrStatus": "not_required",
  "malwareScanStatus": "not_scanned",
  "provider": null,
  "model": null,
  "warnings": [
    "Malware scanning is not configured; this file has not been scanned."
  ],
  "fields": [
    {
      "key": "invoice_number",
      "label": "رقم الفاتورة / Invoice number",
      "value": "INV-2026-001",
      "validationStatus": "present",
      "method": "deterministic-regex",
      "sourceLocation": "text line 2"
    }
  ]
}
```

Honest status values:

| Field | Values |
|---|---|
| `status` | `completed`, `unavailable`, `failed` |
| extraction `status` | `processing`, `completed`, `unavailable`, `failed` |
| `ocrStatus` | `not_required`, `available`, `OCR_UNAVAILABLE`, `EXTRACTION_UNAVAILABLE` |
| `malwareScanStatus` | `not_scanned` (current implementation only) |
| field `validationStatus` | `present`, `invalid`, `missing`, `unverified` |

The response never includes a fabricated confidence score. OCR and malware status are reported exactly as observed.

### 2.5 Validate alias

`POST /api/v1/documents/:id/validate`

Backward-compatible alias for `POST /api/v1/documents/:id/process`. It performs real processing; it is not a metadata-only simulation.

### 2.6 Get extraction and findings

`GET /api/v1/documents/:id/extraction`

Permission: `shipments.documents.read` plus document visibility.

Response:

```json
{
  "documentId": "doc_...",
  "status": "completed",
  "documentType": "commercial_invoice",
  "extractionMethod": "deterministic-text-v1",
  "ocrStatus": "not_required",
  "malwareScanStatus": "not_scanned",
  "fields": [],
  "warnings": [],
  "provider": null,
  "model": null,
  "errorCode": null,
  "updatedAt": "2026-10-21T10:01:00.000Z",
  "findings": [
    {
      "id": "find_...",
      "code": "REQUIRED_FIELD_MISSING",
      "severity": "ERROR",
      "field": "total",
      "observed": null,
      "expected": "present",
      "message": "Required field total is missing.",
      "suggestedAction": "Add the missing value and re-process the document.",
      "requiresReview": true,
      "sourceDocumentIds": ["doc_..."]
    }
  ]
}
```

Full extracted text and storage keys are not returned. Findings are scoped to the caller's organization.

`404 extraction_not_available` means the document has not been processed yet.

---

## 3. Consistency findings

### 3.1 Recompute and persist

`POST /api/v1/shipments/:id/consistency`

Permission: `shipments.documents.read` plus shipment access.

Response:

```json
{
  "shipmentId": "shp_...",
  "ruleVersion": "2026-10-21.1",
  "documentsChecked": 3,
  "findings": [
    {
      "id": "find_...",
      "code": "GROSS_WEIGHT_MISMATCH",
      "severity": "ERROR",
      "documentId": "doc_...",
      "field": "gross_weight_kg",
      "observed": "1250.5",
      "expected": "1200",
      "message": "Packing list gross weight (1250.5 kg) differs from invoice gross weight (1200 kg).",
      "suggestedAction": "Confirm the correct gross weight and request a corrected document if needed.",
      "requiresReview": true,
      "sourceDocumentIds": ["doc_1", "doc_2"],
      "createdAt": "2026-10-21T10:02:00.000Z"
    }
  ]
}
```

Findings are replaced for the caller's organization each time the endpoint runs. They are review prompts, not customs or legal conclusions.

### 3.2 Read persisted findings

`GET /api/v1/shipments/:id/consistency`

Returns `{ shipmentId, findings }`. Without a database it returns an empty list with `persistence: "unavailable"`.

### 3.3 Compatibility alias

`POST /api/v1/documents/consistency/:shipmentId`

Same behavior as `POST /api/v1/shipments/:id/consistency`.

---

## 4. Shipment intelligence

### 4.1 Get risk and delay

`GET /api/v1/shipments/:id/intelligence`

Permission: `shipments.read` plus shipment access. A party that cannot view shipment documents receives `404` rather than a misleading risk score built from invisible documents.

Response:

```json
{
  "shipment": {
    "id": "shp_...",
    "reference": "NAQ-2026-001",
    "status": "IN_TRANSIT"
  },
  "risk": {
    "score": 42,
    "category": "medium",
    "method": "deterministic-rules-v1",
    "ruleVersion": "risk-v1-2026-10-21",
    "dataCompleteness": 75,
    "factors": [
      {
        "code": "MISSING_REQUIRED_DOCUMENTS",
        "label": "Required shipping documents are missing",
        "weight": 24,
        "evidence": {
          "missingTypes": ["bill_of_lading", "certificate_of_origin"],
          "status": "IN_TRANSIT"
        },
        "dimension": "documents"
      }
    ],
    "recommendations": [
      "Request the missing shipping documents before the next operational milestone."
    ]
  },
  "delay": {
    "status": "insufficient_data",
    "estimatedDelayDays": null,
    "minDelayDays": null,
    "maxDelayDays": null,
    "riskCategory": "medium",
    "method": "deterministic-milestones-v1",
    "ruleVersion": "delay-v1-2026-10-21",
    "dataCompleteness": 75,
    "factors": [
      {
        "code": "NO_PLANNED_ARRIVAL_DATE",
        "label": "No planned arrival/ETA is recorded for this shipment",
        "evidence": { "status": "IN_TRANSIT" }
      }
    ],
    "recommendations": [
      "Record a planned arrival date before relying on a delay estimate."
    ]
  },
  "findings": [],
  "documents": [],
  "limitations": [
    "Risk and delay are operational indicators derived from recorded data.",
    "No live weather, port congestion, carrier performance or customs status source is configured.",
    "A delay in days is not estimated unless a planned ETA is recorded; this schema currently has no ETA field."
  ]
}
```

Delay status values:

- `observed` — both departure and arrival/delivery are recorded; the response reports observed transit duration, not a “delay”.
- `insufficient_data` — no planned ETA or insufficient milestones; all day estimates are `null`.

Risk is a transparent deterministic indicator, not a trained model.

### 4.2 Recompute

`POST /api/v1/shipments/:id/intelligence/refresh`

Recomputes risk/delay and appends new assessment rows. Returns the full assessment object (`shipment`, `risk`, `delay`, `findings`, `documents`) without the `limitations` wrapper.

### 4.3 History

`GET /api/v1/shipments/:id/intelligence/history`

Returns the latest 20 risk assessments and 20 delay estimates for the caller's organization.

### 4.4 Legacy delay endpoint

`POST /api/v1/ai/predict-delay`

Request:

```json
{ "shipmentId": "shp_..." }
```

If no `shipmentId` is supplied, the route returns `400` with `code: "shipment_required"`. Legacy free-text fields are accepted by the schema only to return that explicit migration error. The route never invents a delay from a route string.

---

## 5. Copilot and retrieval

### 5.1 Provider status

`GET /api/v1/ai/status`

```json
{
  "provider": "none",
  "model": null,
  "providerAvailable": false,
  "ocrEnabled": false,
  "retrievalMethod": "deterministic-keyword-v1",
  "aiServiceUrlConfigured": true
}
```

No API key, base URL credential or prompt is returned.

### 5.2 Ask the Copilot

`POST /api/v1/ai/copilot`

Request:

```json
{
  "message": "ما هي المستندات الناقصة في الشحنة؟",
  "shipmentId": "shp_...",
  "conversationId": "conv_..."
}
```

`message` or `question` is required, maximum 2,000 characters. `shipmentId` is optional; when present, shipment access is enforced. `conversationId` must belong to the authenticated user and organization.

Response:

```json
{
  "answer": "ملخص من السجلات المصرح بها (استرجاع حتمي، وليس بحثًا دلاليًا)...",
  "conversationId": "conv_...",
  "status": "degraded",
  "sources": [
    {
      "type": "document",
      "id": "doc_...",
      "label": "invoice.pdf",
      "documentId": "doc_...",
      "documentType": "commercial_invoice"
    }
  ],
  "suggestedActions": [
    "راجع ملاحظات الاتساق وصحّح التعارضات المؤكدة"
  ],
  "warnings": [
    "AI_PROVIDER is not configured; the Copilot returned a deterministic summary without a language model.",
    "Retrieval is deterministic keyword matching; semantic/vector search is not enabled."
  ],
  "providerAvailable": false,
  "retrievalMethod": "deterministic-keyword-v1",
  "persisted": true
}
```

Status values:

- `completed` — provider returned a non-empty answer.
- `degraded` — no provider, provider failure, or invalid provider output; deterministic summary returned.
- `unavailable` — reserved for an unavailable response.
- `error` — reserved for an unexpected failure.

With `AI_PROVIDER=none`, `providerAvailable` is `false` and the response is an explicitly labelled deterministic summary. It is not a model answer. The response does not expose provider credentials or model output metadata.

### 5.3 Read a conversation

`GET /api/v1/ai/conversations/:id`

Returns the conversation and its messages, including sources, suggested actions, warnings and status. Cross-tenant or cross-user access returns `404`.

### 5.4 Retrieval search

`POST /api/v1/ai/retrieval/search`

```json
{
  "query": "بيان وزن الشحنة",
  "shipmentId": "shp_..."
}
```

Response:

```json
{
  "method": "deterministic-keyword-v1",
  "empty": false,
  "sources": [],
  "snippets": [
    {
      "sourceId": "doc:doc_...",
      "sourceType": "document",
      "snippet": "Gross weight: 1200 kg"
    }
  ]
}
```

This is deterministic keyword retrieval over authorized records. It is **not** semantic/vector search, and no embedding model is used.

---

## 6. Tenant and privacy rules

- The organization always comes from `getAuthUser()`.
- `loadShipmentAccess()` checks owner or party access for every shipment operation.
- Document visibility is:
  - owner: all documents on the shipment;
  - party with `canViewDocuments`: `shipment` documents and its own `private` uploads;
  - party without `canViewDocuments`: no documents and no risk score.
- Financial quotation context requires owner or `canViewFinancials`.
- Copilot conversation reads require matching organization **and** user.
- `AiExecution` stores no prompts, no document text and no model output.
- `DocumentExtraction.extractedText` is stored for processing provenance but is not returned by the document APIs.

---

## 7. Example flow

```text
1. POST /api/v1/shipments/{shipmentId}/documents
2. POST /api/v1/documents/{documentId}/process
3. GET  /api/v1/documents/{documentId}/extraction
4. POST /api/v1/shipments/{shipmentId}/consistency
5. GET  /api/v1/shipments/{shipmentId}/intelligence
6. POST /api/v1/ai/copilot
```

All six calls use the same Bearer token and enforce the same tenant and shipment access checks.
