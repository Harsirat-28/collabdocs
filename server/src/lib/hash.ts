import { createHash } from "node:crypto";

/** Hashes a refresh token JWT for storage/lookup so raw tokens never sit in the DB. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
