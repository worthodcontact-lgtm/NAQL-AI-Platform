import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createStorageKey,
  extensionForFilename,
  InvalidFilenameError,
  LocalFileStorageAdapter,
  resolveStoragePath,
  sanitizeDisplayFilename,
  StorageKeyError
} from "../storage/adapter.js";

const roots: string[] = [];

async function makeRoot() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "naql-storage-test-"));
  const root = path.join(base, "storage");
  await fs.mkdir(root, { recursive: true });
  roots.push(base);
  return { base, root };
}

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop()!;
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("storage key safety", () => {
  it.each([
    "../escape.txt",
    "..\\escape.txt",
    "/absolute.txt",
    "C:\\temp\\escape.txt",
    "shipments/../../escape.txt",
    "shipments/./escape.txt",
    "shipments//escape.txt",
    "shipments\\escape.txt",
    "shipments/%2e%2e/escape.txt"
  ])("rejects malicious key %s", async (key) => {
    const { root } = await makeRoot();
    const adapter = new LocalFileStorageAdapter(root);
    await expect(adapter.put(key, Buffer.from("x"), "text/plain")).rejects.toBeInstanceOf(StorageKeyError);
    await expect(adapter.exists(key)).resolves.toBe(false);
    expect(() => resolveStoragePath(root, key)).toThrow(StorageKeyError);
  });

  it("writes a valid server-generated key inside the root and nowhere else", async () => {
    const { base, root } = await makeRoot();
    const adapter = new LocalFileStorageAdapter(root);
    const key = createStorageKey(["shipments", "shp_1", "documents"], ".pdf");

    await adapter.put(key, Buffer.from("safe"), "application/pdf");

    expect(await adapter.exists(key)).toBe(true);
    expect(await fs.readFile(path.join(root, key), "utf8")).toBe("safe");
    await expect(fs.access(path.join(base, "escaped.txt"))).rejects.toBeTruthy();
    expect(adapter.getUrl(key)).toMatch(/^file:\/\//);
  });

  it("never embeds the original filename or client path in the generated key", () => {
    const key = createStorageKey(["shipments", "shp_1", "documents"], extensionForFilename("Invoice ../ 2026.PDF"));
    expect(key).toMatch(/^shipments\/shp_1\/documents\/[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain("Invoice");
    expect(key).not.toContain("..");
  });

  it("rejects unsafe namespace segments", () => {
    expect(() => createStorageKey(["shipments", "../x", "documents"])).toThrow(StorageKeyError);
    expect(() => createStorageKey(["shipments", "shp/1", "documents"])).toThrow(StorageKeyError);
  });
});

describe("display filename validation", () => {
  it.each(["invoice.pdf", "فاتورة الشحنة.pdf", "packing list 2026.csv", "a_b-c.json"])(
    "accepts %s",
    (name) => {
      expect(sanitizeDisplayFilename(name)).toBe(name);
    }
  );

  it.each([
    "",
    "   ",
    ".",
    "..",
    "../invoice.pdf",
    "..\\invoice.pdf",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "folder/invoice.pdf",
    "folder\\invoice.pdf",
    "invoice.pdf\u0000.txt",
    "invoice.pdf."
  ])("rejects %j", (name) => {
    expect(() => sanitizeDisplayFilename(name)).toThrow(InvalidFilenameError);
  });
});
