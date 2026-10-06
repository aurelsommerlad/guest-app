import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for key box codes (ADR 0017). AES-256-GCM with a server-only key
 * (ACCESS_CODE_KEY, 32 bytes base64). The unit's identity is bound as associated data, so
 * a ciphertext copied to another unit or tenant does not decrypt.
 *
 * Stored format: "v1.<iv>.<ciphertext>.<tag>" (base64url). The code itself is never
 * stored in clear text, logged, or put into a URL.
 */
const VERSION = "v1";
const IV_BYTES = 12;

export class AccessCodeKeyError extends Error {
  override name = "AccessCodeKeyError";
}

export function parseAccessCodeKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new AccessCodeKeyError("ACCESS_CODE_KEY must be 32 bytes (base64)");
  return key;
}

export type AccessCodeBinding = { tenantId: string; propertyId: string; unitId: string };

function aad(binding: AccessCodeBinding): Buffer {
  return Buffer.from(`${binding.tenantId}/${binding.propertyId}/${binding.unitId}`, "utf8");
}

export function encryptAccessCode(key: Buffer, binding: AccessCodeBinding, code: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [VERSION, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Undefined for anything that does not decrypt (wrong key, other unit, tampered). */
export function decryptAccessCode(
  key: Buffer,
  binding: AccessCodeBinding,
  stored: string,
): string | undefined {
  const [version, iv, ciphertext, tag] = stored.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return undefined;
  }
}
