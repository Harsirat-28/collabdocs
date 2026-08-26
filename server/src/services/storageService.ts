import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../lib/env.js";

/**
 * Storage abstraction so the local-disk implementation used in development
 * can be swapped for S3-compatible object storage later without touching
 * callers (upload controller, editor image insertion).
 */
export interface StorageDriver {
  /**
   * Persists a file and returns the URL path clients should use to fetch it.
   * `extension` must come from a server-side allowlist derived from the
   * validated MIME type, not from client-supplied filename input.
   */
  save(buffer: Buffer, extension: string): Promise<{ url: string }>;
}

const UPLOAD_ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);

class LocalDiskStorage implements StorageDriver {
  async save(buffer: Buffer, extension: string): Promise<{ url: string }> {
    await mkdir(UPLOAD_ROOT, { recursive: true });

    const filename = `${randomUUID()}${extension}`;
    await writeFile(path.join(UPLOAD_ROOT, filename), buffer);

    return { url: `/uploads/${filename}` };
  }
}

export const storage: StorageDriver = new LocalDiskStorage();
export { UPLOAD_ROOT };
