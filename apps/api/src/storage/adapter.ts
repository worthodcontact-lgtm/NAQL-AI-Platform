import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";

export interface StoredObjectMeta {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getUrl(key: string): string;
}

class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  getUrl(key: string): string { return `memory://${key}`; }
  get(key: string): Buffer | undefined { return this.store.get(key); }
}

class LocalFileStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}
  async put(key: string, data: Buffer): Promise<void> {
    const target = path.join(this.root, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  getUrl(key: string): string { return `file://${path.join(this.root, key)}`; }
}

let adapter: StorageAdapter;
if (process.env.STORAGE_PATH) {
  adapter = new LocalFileStorageAdapter(process.env.STORAGE_PATH);
} else {
  adapter = new InMemoryStorageAdapter();
}

export const storageAdapter = adapter;
export const isInMemoryStorage = adapter instanceof InMemoryStorageAdapter;
