import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque secrets for guest links and guest sessions (ADR 0011).
 *
 * - 32 random bytes from the OS CSPRNG = 256 bit entropy, base64url (43 chars, URL-safe).
 * - Contains no reservation id, guest id or personal data.
 * - Only the SHA-256 hash is stored. A fast hash is sufficient (and intended) because the
 *   input has full 256-bit entropy: there is nothing to brute-force or look up.
 */
export const SECRET_BYTES = 32;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function generateSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

/** Cheap shape check before any database lookup (rejects garbage and oversized input). */
export function isWellFormedSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** SHA-256, lowercase hex – the only form in which secrets are persisted. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function isSecretHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

/** Constant-time string comparison via SHA-256 digests (equal length by construction). */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a, "utf8").digest(),
    createHash("sha256").update(b, "utf8").digest(),
  );
}
