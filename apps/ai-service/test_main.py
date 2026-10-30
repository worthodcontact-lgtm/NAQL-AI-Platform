import base64

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def pdf_with_text(text: str) -> bytes:
    """Build a small, structurally valid PDF with one text object."""
    content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET" if text else ""
    objects = [
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
        f"4 0 obj\n<< /Length {len(content)} >>\nstream\n{content}\nendstream\nendobj\n",
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    output = "%PDF-1.4\n"
    offsets = [0]
    for value in objects:
        offsets.append(len(output.encode("utf-8")))
        output += value
    xref_offset = len(output.encode("utf-8"))
    output += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        output += f"{offset:010d} 00000 n \n"
    output += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    )
    return output.encode("utf-8")


def extract(content: bytes, content_type: str, ocr: bool = False):
    return client.post(
        "/documents/extract",
        json={
            "filename": "document.bin",
            "contentType": content_type,
            "contentBase64": base64.b64encode(content).decode("ascii"),
            "ocrEnabled": ocr,
        },
    )


def test_health_reports_real_pdf_capability():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["capabilities"]["pdfText"] is True


def test_extracts_text_and_pdf_text():
    text_response = extract(b"Invoice No: P3-100\nTotal: 100 USD", "text/plain")
    assert text_response.status_code == 200
    assert text_response.json()["status"] == "ok"
    assert "P3-100" in text_response.json()["text"]

    pdf_response = extract(pdf_with_text("Invoice P3 Test 100 USD"), "application/pdf")
    assert pdf_response.status_code == 200
    body = pdf_response.json()
    assert body["status"] == "ok"
    assert body["method"] == "pdf-text"
    assert body["ocrStatus"] == "not_required"
    assert "Invoice P3 Test 100 USD" in body["text"]


def test_reports_corrupt_blank_and_scanned_pdf_without_faking_text():
    corrupt = extract(b"%PDF-1.4 this is not a complete pdf", "application/pdf")
    assert corrupt.status_code == 200
    assert corrupt.json()["status"] == "unavailable"
    assert corrupt.json()["text"] is None

    blank = extract(pdf_with_text(""), "application/pdf")
    assert blank.status_code == 200
    assert blank.json()["status"] == "unavailable"
    assert blank.json()["ocrStatus"] == "OCR_UNAVAILABLE"

    blank_with_ocr = extract(pdf_with_text(""), "application/pdf", ocr=True)
    assert blank_with_ocr.status_code == 200
    assert blank_with_ocr.json()["status"] == "unavailable"
    assert blank_with_ocr.json()["ocrStatus"] == "OCR_UNAVAILABLE"


def test_ocr_is_explicitly_unavailable_when_disabled_or_missing_engine():
    response = extract(b"\x89PNG\r\n\x1a\nnot-a-real-image", "image/png", ocr=False)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["method"] == "ocr"
    assert body["ocrStatus"] == "OCR_UNAVAILABLE"
    assert "disabled" in " ".join(body["warnings"]).lower()


def test_rejects_invalid_unsupported_and_oversized_documents():
    invalid = client.post(
        "/documents/extract",
        json={
            "filename": "x.txt",
            "contentType": "text/plain",
            "contentBase64": "not base64!",
        },
    )
    assert invalid.status_code == 400

    unsupported = extract(b"PK\x03\x04zip", "application/zip")
    assert unsupported.status_code == 200
    assert unsupported.json()["status"] == "unavailable"
    assert unsupported.json()["method"] == "none"

    fake_pdf = extract(b"not a pdf at all", "application/pdf")
    assert fake_pdf.status_code == 415

    oversized = extract(b"a" * (10 * 1024 * 1024 + 1), "text/plain")
    assert oversized.status_code == 413


def test_deterministic_landed_cost_contract():
    response = client.post(
        "/landed-cost",
        json={
            "productCost": 1000,
            "freightCost": 100,
            "insuranceRate": 0.01,
            "customsDutyRate": 0.1,
            "taxRate": 0.14,
            "fees": 20,
            "currency": "USD",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["currency"] == "USD"
    assert body["total"] > 1000
