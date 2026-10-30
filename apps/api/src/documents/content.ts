import path from "node:path";

/**
 * Upload validation for shipment documents.
 *
 * The declared MIME type and extension must agree with the bytes we actually
 * received. This prevents an executable, HTML page or SVG from being stored
 * under a trusted image/PDF label. Malware scanning is a separate control and
 * is reported honestly as unavailable until a scanner is configured.
 */

export const ALLOWED_DOCUMENT_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "text/csv": [".csv"],
  "application/json": [".json"],
  "application/xml": [".xml"],
  "text/plain": [".txt"]
} as const;

export type AllowedDocumentType = keyof typeof ALLOWED_DOCUMENT_TYPES;

export class FileValidationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "FileValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((value, index) => buffer[index] === value);
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  // Reject NUL bytes and implausible control characters. UTF-8 BOM is allowed.
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) start = 3;
  for (let index = start; index < buffer.length; index += 1) {
    const value = buffer[index];
    if (value === 0) return false;
    if (value < 0x09 || (value > 0x0d && value < 0x20)) return false;
  }
  return true;
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

export interface ValidatedFile {
  contentType: AllowedDocumentType;
  extension: string;
  size: number;
}

/**
 * Validate an upload against its declared MIME type, filename extension and
 * content signature. No decode of untrusted content occurs here.
 */
export function validateFileContent(input: {
  buffer: Buffer;
  filename: string;
  declaredContentType: string;
}): ValidatedFile {
  const declared = input.declaredContentType.toLowerCase().split(";")[0].trim();
  const allowedExtensions = ALLOWED_DOCUMENT_TYPES[declared as AllowedDocumentType];
  if (!allowedExtensions) {
    throw new FileValidationError(
      "unsupported_content_type",
      "Unsupported content type",
      415
    );
  }

  const extension = path.extname(input.filename).toLowerCase();
  if (!(allowedExtensions as readonly string[]).includes(extension)) {
    throw new FileValidationError(
      "extension_content_type_mismatch",
      `Filename extension ${extension || "(none)"} does not match ${declared}`,
      415
    );
  }

  if (input.buffer.length === 0) {
    throw new FileValidationError("empty_file", "Uploaded file is empty");
  }

  let signatureOk = false;
  switch (declared) {
    case "application/pdf":
      signatureOk = isPdf(input.buffer);
      break;
    case "image/png":
      signatureOk = startsWith(input.buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      break;
    case "image/jpeg":
      signatureOk = startsWith(input.buffer, [0xff, 0xd8, 0xff]);
      break;
    case "application/json": {
      if (!looksLikeText(input.buffer)) break;
      const text = input.buffer.toString("utf8").trimStart();
      signatureOk = text.startsWith("{") || text.startsWith("[");
      break;
    }
    case "application/xml": {
      if (!looksLikeText(input.buffer)) break;
      const text = input.buffer.toString("utf8").trimStart();
      signatureOk = text.startsWith("<?xml") || text.startsWith("<");
      break;
    }
    case "text/csv":
    case "text/plain":
      signatureOk = looksLikeText(input.buffer);
      break;
    default:
      signatureOk = false;
  }

  if (!signatureOk) {
    throw new FileValidationError(
      "content_signature_mismatch",
      "File content does not match the declared type",
      415
    );
  }

  return { contentType: declared as AllowedDocumentType, extension, size: input.buffer.length };
}

/** Honest malware-scan status until a scanner integration exists. */
export const MALWARE_SCAN_STATUS = "not_scanned" as const;

export function malwareWarning(): string {
  return "Malware scanning is not configured; this file has not been scanned.";
}
