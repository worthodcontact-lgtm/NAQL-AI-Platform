import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface StoredObjectMeta {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  /** Read the stored bytes for server-side processing. Never exposed directly. */
  read(key: string): Promise<Buffer>;
  /** Delete bytes for retention. Implementations must be idempotent. */
  delete(key: string): Promise<void>;
}

export class StorageKeyError extends Error {
  readonly code = "invalid_storage_key";
  constructor(message = "Invalid storage key") {
    super(message);
    this.name = "StorageKeyError";
  }
}

export class InvalidFilenameError extends Error {
  readonly code = "invalid_filename";
  constructor(message = "Invalid filename") {
    super(message);
    this.name = "InvalidFilenameError";
  }
}

const MAX_FILENAME_LENGTH = 255;
const MAX_STORAGE_KEY_LENGTH = 1024;
const STORAGE_NAMESPACE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const STORAGE_KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,12}$/i;

/**
 * Validate a client-supplied display name without using it as a storage path.
 *
 * Path separators, absolute paths, Windows drive prefixes, traversal segments,
 * control characters, and trailing Windows-unsafe characters are rejected. The
 * original (trimmed) name is preserved for display only.
 */
export function sanitizeDisplayFilename(raw: unknown): string {
  if (typeof raw !== "string") throw new InvalidFilenameError("Filename must be a string");
  const value = raw.trim();
  if (!value || value.length > MAX_FILENAME_LENGTH) {
    throw new InvalidFilenameError("Filename must be between 1 and 255 characters");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new InvalidFilenameError("Filename contains control characters");
  }
  if (value === "." || value === "..") throw new InvalidFilenameError("Filename is not allowed");
  if (value.includes("/") || value.includes("\\")) {
    throw new InvalidFilenameError("Filename must not contain path separators");
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new InvalidFilenameError("Absolute paths are not allowed");
  }
  if (value.endsWith(".") || value.endsWith(" ")) {
    throw new InvalidFilenameError("Filename has an unsafe trailing character");
  }
  return value;
}

/** The extension is the only part of a client filename retained in a key. */
export function extensionForFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return SAFE_EXTENSION.test(extension) ? extension : "";
}

function assertSafeNamespaceSegment(segment: string): string {
  if (!STORAGE_NAMESPACE_SEGMENT.test(segment)) {
    throw new StorageKeyError("Storage namespace contains an unsafe segment");
  }
  return segment;
}

/**
 * Storage keys are always server-generated. They contain only validated
 * namespace segments plus a random UUID and an optional safe extension.
 */
export function createStorageKey(namespace: readonly string[], extension = ""): string {
  if (!Array.isArray(namespace) || namespace.length === 0) {
    throw new StorageKeyError("Storage namespace is required");
  }
  const safeNamespace = namespace.map(assertSafeNamespaceSegment);
  const safeExtension = SAFE_EXTENSION.test(extension) ? extension.toLowerCase() : "";
  return [...safeNamespace, `${randomUUID()}${safeExtension}`].join("/");
}

/**
 * Validate a key that is about to be read or written, including legacy keys
 * already stored in the database.
 */
export function assertSafeStorageKey(key: string): string {
  if (typeof key !== "string" || !key || key.length > MAX_STORAGE_KEY_LENGTH) {
    throw new StorageKeyError("Storage key is empty or too long");
  }
  if (key.includes("\\") || key.includes("\u0000")) {
    throw new StorageKeyError("Storage key contains an unsafe character");
  }
  if (key.startsWith("/") || path.isAbsolute(key) || /^[A-Za-z]:/.test(key)) {
    throw new StorageKeyError("Absolute storage keys are not allowed");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !STORAGE_KEY_SEGMENT.test(segment))) {
    throw new StorageKeyError("Storage key contains an unsafe path segment");
  }
  return key;
}

/** Resolve a key and prove the final path remains inside the configured root. */
export function resolveStoragePath(root: string, key: string): string {
  assertSafeStorageKey(key);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, key);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StorageKeyError("Storage key escapes the storage root");
  }
  return target;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, Buffer>();
  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    this.store.set(assertSafeStorageKey(key), data);
  }
  getUrl(key: string): string {
    return `memory://${assertSafeStorageKey(key)}`;
  }
  async exists(key: string): Promise<boolean> {
    return this.store.has(assertSafeStorageKey(key));
  }
  get(key: string): Buffer | undefined {
    return this.store.get(assertSafeStorageKey(key));
  }
  async read(key: string): Promise<Buffer> {
    const value = this.store.get(assertSafeStorageKey(key));
    if (!value) throw new Error("Stored object not found");
    return value;
  }
  async delete(key: string): Promise<void> {
    this.store.delete(assertSafeStorageKey(key));
  }
}

export class LocalFileStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const target = resolveStoragePath(this.root, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: "wx" });
  }

  getUrl(key: string): string {
    return pathToFileURL(resolveStoragePath(this.root, key)).href;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const target = resolveStoragePath(this.root, key);
      const stat = await fs.stat(target);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(resolveStoragePath(this.root, key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(resolveStoragePath(this.root, key));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

let adapter: StorageAdapter;
if (process.env.STORAGE_PATH) {
  adapter = new LocalFileStorageAdapter(process.env.STORAGE_PATH);
} else if (process.env.NODE_ENV === "production") {
  // In-memory bytes disappear on restart and cannot be the production store.
  // Fail at startup instead of silently accepting documents that will be lost.
  throw new Error(
    "STORAGE_PATH is required in production. Configure a writable directory outside the web root."
  );
} else {
  adapter = new InMemoryStorageAdapter();
}

export const storageAdapter = adapter;
export const isInMemoryStorage = adapter instanceof InMemoryStorageAdapter;
