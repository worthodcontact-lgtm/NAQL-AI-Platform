"""NAQL AI Python service.

The TypeScript API is the authoritative business system. This service only
performs document text extraction / OCR and a deterministic landed-cost
calculation. It never decides shipment authorization and it does not pretend an
OCR engine or AI provider exists when it is not installed.
"""

from __future__ import annotations

import base64
import binascii
import io
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="NAQL AI Service", version="0.2.0")

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

try:  # Optional PDF text extraction.
    from pypdf import PdfReader  # type: ignore
except Exception:  # pragma: no cover - depends on the local environment
    PdfReader = None  # type: ignore

try:  # Optional OCR; the tesseract executable must also be installed.
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover - depends on the local environment
    pytesseract = None  # type: ignore
    Image = None  # type: ignore

try:  # Optional PDF rasterizer for scanned-PDF OCR.
    import pypdfium2 as pdfium  # type: ignore
except Exception:  # pragma: no cover - depends on the local environment
    pdfium = None  # type: ignore

MAX_OCR_PAGES = 5


class LandedCostInput(BaseModel):
    productCost: float = 0.0
    freight: float = 0.0
    insurance: float = 0.0
    customsDutyRate: float = 0.0
    taxRate: float = 0.0
    fees: float = 0.0
    currency: str = "USD"


class DocumentExtractInput(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    contentType: str = Field(min_length=1, max_length=100)
    contentBase64: str = Field(min_length=1)
    ocrEnabled: bool = False


class CopilotInput(BaseModel):
    question: str
    context: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "naql-ai-service",
        "version": "0.2.0",
        "capabilities": {
            "textExtraction": True,
            "pdfText": PdfReader is not None,
            "pdfOcr": PdfReader is not None and pdfium is not None and pytesseract is not None,
            "ocr": pytesseract is not None and Image is not None,
        },
        "note": "OCR also requires the tesseract executable; capability is reported honestly.",
    }


@app.post("/landed-cost")
def landed_cost(payload: LandedCostInput):
    customs_duty = round(payload.productCost * payload.customsDutyRate, 2)
    subtotal = payload.productCost + payload.freight + payload.insurance + customs_duty + payload.fees
    taxes = round(subtotal * payload.taxRate, 2)
    total = round(subtotal + taxes, 2)
    return {
        "currency": payload.currency,
        "productCost": payload.productCost,
        "freight": payload.freight,
        "insurance": payload.insurance,
        "customsDuty": customs_duty,
        "taxes": taxes,
        "total": total,
    }


def _decode_payload(payload: DocumentExtractInput) -> bytes:
    try:
        data = base64.b64decode(payload.contentBase64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Invalid base64 content")
    if not data:
        raise HTTPException(status_code=400, detail="Empty document")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Document too large")
    return data


def _extract_pdf_text(data: bytes) -> str:
    if PdfReader is None:
        raise RuntimeError("pdf_text_extractor_unavailable")
    reader = PdfReader(io.BytesIO(data))
    pages: List[str] = []
    for page in reader.pages[:50]:
        text = page.extract_text() or ""
        if text.strip():
            pages.append(text)
    return "\n\n".join(pages).strip()


def _extract_image_text(data: bytes) -> str:
    if pytesseract is None or Image is None:
        raise RuntimeError("ocr_unavailable")
    image = Image.open(io.BytesIO(data))
    return (pytesseract.image_to_string(image) or "").strip()


def _extract_pdf_ocr(data: bytes) -> str:
    if pdfium is None:
        raise RuntimeError("pdf_rasterizer_unavailable")
    if pytesseract is None:
        raise RuntimeError("ocr_unavailable")
    document = pdfium.PdfDocument(io.BytesIO(data))
    pages: List[str] = []
    try:
        for index in range(min(len(document), MAX_OCR_PAGES)):
            page = document[index]
            image = page.render(scale=2.0).to_pil()
            text = (pytesseract.image_to_string(image) or "").strip()
            if text:
                pages.append(text)
            page.close()
    finally:
        document.close()
    return "\n\n".join(pages).strip()


@app.post("/documents/extract")
def extract_document(payload: DocumentExtractInput):
    data = _decode_payload(payload)
    content_type = payload.contentType.lower().split(";")[0].strip()
    warnings: List[str] = []

    text_types = {"text/plain", "text/csv", "application/json", "application/xml"}
    if content_type in text_types:
        try:
            return {
                "status": "ok",
                "text": data.decode("utf-8"),
                "method": "text",
                "ocrStatus": "not_required",
                "warnings": warnings,
            }
        except UnicodeDecodeError:
            return {
                "status": "unavailable",
                "text": None,
                "method": "text",
                "ocrStatus": "EXTRACTION_UNAVAILABLE",
                "warnings": ["The text document is not valid UTF-8."],
            }

    if content_type == "application/pdf":
        if b"%PDF-" not in data[:1024]:
            raise HTTPException(status_code=415, detail="File content is not a PDF")
        try:
            text = _extract_pdf_text(data)
        except RuntimeError:
            return {
                "status": "unavailable",
                "text": None,
                "method": "pdf-text",
                "ocrStatus": "EXTRACTION_UNAVAILABLE",
                "warnings": ["pypdf is not installed; PDF text extraction is unavailable."],
            }
        except Exception:
            return {
                "status": "unavailable",
                "text": None,
                "method": "pdf-text",
                "ocrStatus": "EXTRACTION_UNAVAILABLE",
                "warnings": ["The PDF could not be parsed."],
            }
        if text:
            return {
                "status": "ok",
                "text": text,
                "method": "pdf-text",
                "ocrStatus": "not_required",
                "warnings": warnings,
            }
        ocr_warning = None
        if payload.ocrEnabled:
            try:
                ocr_text = _extract_pdf_ocr(data)
                if ocr_text:
                    return {
                        "status": "ok",
                        "text": ocr_text,
                        "method": "pdf-ocr",
                        "ocrStatus": "available",
                        "warnings": warnings,
                    }
                ocr_warning = "Scanned-PDF OCR ran but returned no text."
            except RuntimeError as error:
                if str(error) == "pdf_rasterizer_unavailable":
                    ocr_warning = "Scanned-PDF OCR is unavailable: the optional pypdfium2 rasterizer is not installed."
                else:
                    ocr_warning = "Scanned-PDF OCR is unavailable: pytesseract and the tesseract executable are not installed."
            except Exception:
                ocr_warning = "The scanned PDF could not be rendered for OCR."
        return {
            "status": "unavailable",
            "text": None,
            "method": "pdf-text",
            "ocrStatus": "OCR_UNAVAILABLE",
            "warnings": [
                ocr_warning
                or "The PDF contains no extractable text. Scanned-PDF OCR is disabled (AI_OCR_ENABLED=false)."
            ],
        }

    if content_type in {"image/png", "image/jpeg"}:
        if not payload.ocrEnabled:
            return {
                "status": "unavailable",
                "text": None,
                "method": "ocr",
                "ocrStatus": "OCR_UNAVAILABLE",
                "warnings": ["OCR is disabled by configuration (AI_OCR_ENABLED=false)."],
            }
        try:
            text = _extract_image_text(data)
        except RuntimeError:
            return {
                "status": "unavailable",
                "text": None,
                "method": "ocr",
                "ocrStatus": "OCR_UNAVAILABLE",
                "warnings": ["An OCR engine (pytesseract + tesseract) is not installed."],
            }
        except Exception:
            return {
                "status": "unavailable",
                "text": None,
                "method": "ocr",
                "ocrStatus": "OCR_UNAVAILABLE",
                "warnings": ["The image could not be processed by the OCR engine."],
            }
        if text:
            return {
                "status": "ok",
                "text": text,
                "method": "ocr",
                "ocrStatus": "available",
                "warnings": warnings,
            }
        return {
            "status": "unavailable",
            "text": None,
            "method": "ocr",
            "ocrStatus": "OCR_UNAVAILABLE",
            "warnings": ["OCR ran but returned no text."],
        }

    return {
        "status": "unavailable",
        "text": None,
        "method": "none",
        "ocrStatus": "EXTRACTION_UNAVAILABLE",
        "warnings": [f"No extractor is configured for {content_type}."],
    }


@app.post("/copilot/answer")
def copilot_answer(payload: CopilotInput):
    # The TypeScript gateway is now authoritative. This endpoint remains only
    # for older clients and never claims that a model answered.
    return {
        "answer": "The Copilot provider is configured in the TypeScript API, not in this service.",
        "confidence": None,
        "sources": [],
        "disclaimer": "No model was called by this endpoint.",
        "providerAvailable": False,
    }


@app.post("/predict/delay")
def predict_delay(payload: Dict[str, Any]):
    return {
        "status": "insufficient_data",
        "estimatedDelayDays": None,
        "riskLevel": "unknown",
        "method": "not_implemented_in_python_service",
        "disclaimer": "Delay estimation uses authorized shipment records in the TypeScript API.",
        "providerAvailable": False,
    }
