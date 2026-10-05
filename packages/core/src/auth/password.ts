import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Admin password hashing with scrypt (Node's built-in, memory-hard KDF).
 * Format: `scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>` – parameters are stored
 * with each hash, so they can be raised later without invalidating existing hashes.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { ...params, maxmem: 128 * params.N * params.r * 2 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new RangeError(
      `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Constant-time verification; malformed hashes never verify. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (!N || !r || !p || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const expected = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length < 8 || expected.length !== KEY_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  const key = await derive(password, salt, { N, r, p });
  return timingSafeEqual(key, expected);
}

/** A valid hash of a random password – verified against when an e-mail is unknown, so
 * unknown and known accounts take the same time. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}
