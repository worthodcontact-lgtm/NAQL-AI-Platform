import { afterEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  classifyDocument,
  extractDeterministic,
  extractDocument,
  extractText
} from "../extraction.js";
import { validateFileContent, FileValidationError } from "../content.js";

const INVOICE = [
  "Commercial Invoice",
  "Invoice No: INV-2026-77",
  "Date: 2026-10-01",
  "Currency: USD",
  "Gross Weight: 1,200.50 kg",
  "Total: 4500.00",
  "Incoterm: FOB"
].join("\n");

describe("document extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies common logistics documents from headings", () => {
    expect(classifyDocument("COMMERCIAL INVOICE\nInvoice No: 1")).toBe("commercial_invoice");
    expect(classifyDocument("Packing List\nPackages: 4")).toBe("packing_list");
    expect(classifyDocument("Bill of Lading\nB/L No: ABC")).toBe("bill_of_lading");
    expect(classifyDocument("Certificate of Origin\nOrigin: EG")).toBe("certificate_of_origin");
    expect(classifyDocument("Shipping Instructions\nReference: 1")).toBe("shipping_instructions");
    expect(classifyDocument("Customs declaration\nDeclarant: X")).toBe("customs_document");
    expect(classifyDocument("Unknown paper")).toBe("other");
  });

  it("extracts fields with provenance and no invented confidence", () => {
    const result = extractDeterministic(INVOICE);
    expect(result.documentType).toBe("commercial_invoice");
    const invoiceNumber = result.fields.find((field) => field.key === "invoice_number");
    expect(invoiceNumber?.value).toBe("INV-2026-77");
    expect(invoiceNumber?.method).toBe("deterministic-text-v1");
    expect(invoiceNumber?.sourceLocation).toContain("text line");
    expect(invoiceNumber?.confidence).toBeUndefined();

    const total = result.fields.find((field) => field.key === "total");
    expect(total?.normalizedValue).toBe(4500);
    expect(total?.validationStatus).toBe("present");
    expect(result.fields.find((field) => field.key === "currency")?.value).toBe("USD");
    expect(result.fields.find((field) => field.key === "incoterm")?.value).toBe("FOB");
  });

  it("reports missing required fields instead of inventing values", () => {
    const result = extractDeterministic("Commercial Invoice\nInvoice No: INV-1");
    const missing = result.fields.filter((field) => field.validationStatus === "missing").map((field) => field.key);
    expect(missing).toContain("issue_date");
    expect(missing).toContain("currency");
    expect(missing).toContain("total");
    expect(result.warnings.some((warning) => warning.includes("Required field missing"))).toBe(true);
  });

  it("marks malformed dates as invalid", () => {
    const result = extractDeterministic("Commercial Invoice\nInvoice No: INV-2\nDate: 2026-02-31\nTotal: 1");
    const date = result.fields.find((field) => field.key === "issue_date");
    expect(date?.validationStatus).toBe("invalid");
  });

  it("merges provider output but keeps it marked unverified", async () => {
    const gateway = {
      isConfigured: true,
      complete: async () => ({
        status: "completed",
        provider: "openai",
        model: "test",
        usage: {},
        latencyMs: 10,
        attempts: 1,
        data: {
          documentType: "commercial_invoice",
          fields: { invoice_number: "AI-1", total: 99 }
        }
      })
    } as any;

    const result = await extractDocument({ text: INVOICE, gateway });
    expect(result.method).toBe("deterministic+ai-provider");
    expect(result.fields.find((field) => field.key === "invoice_number")?.value).toBe("AI-1");
    expect(result.fields.find((field) => field.key === "invoice_number")?.validationStatus).toBe("unverified");
    expect(result.fields.find((field) => field.key === "currency")?.value).toBe("USD");
  });

  it("returns unavailable when the OCR service is not reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const result = await extractText({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      contentType: "image/jpeg",
      filename: "scan.jpg"
    });
    expect(result.status).toBe("unavailable");
    expect(result.ocrStatus).toBe("EXTRACTION_UNAVAILABLE");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("extracts UTF-8 text without invoking a provider", async () => {
    const result = await extractText({
      buffer: Buffer.from(INVOICE),
      contentType: "text/plain",
      filename: "invoice.txt"
    });
    expect(result.status).toBe("ok");
    expect(result.text).toContain("INV-2026-77");
    expect(result.method).toBe("text");
  });
});

describe("upload content validation", () => {
  it("accepts a real PDF signature", () => {
    const result = validateFileContent({
      buffer: Buffer.from("%PDF-1.4\n%%EOF"),
      filename: "invoice.pdf",
      declaredContentType: "application/pdf"
    });
    expect(result.contentType).toBe("application/pdf");
  });

  it("rejects a PDF with non-PDF bytes", () => {
    expect(() =>
      validateFileContent({
        buffer: Buffer.from("not a pdf"),
        filename: "invoice.pdf",
        declaredContentType: "application/pdf"
      })
    ).toThrow(FileValidationError);
  });

  it("rejects extension/content-type mismatches", () => {
    expect(() =>
      validateFileContent({
        buffer: Buffer.from("hello"),
        filename: "invoice.exe",
        declaredContentType: "text/plain"
      })
    ).toThrow(FileValidationError);
  });

  it("rejects binary content under a text type", () => {
    expect(() =>
      validateFileContent({
        buffer: Buffer.from([0x00, 0x01, 0x02]),
        filename: "notes.txt",
        declaredContentType: "text/plain"
      })
    ).toThrow(FileValidationError);
  });
});
