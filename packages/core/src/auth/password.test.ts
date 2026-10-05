import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("admin password hashing", () => {
  it("hashes with scrypt and a random salt and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain("correct horse");
    expect(await hashPassword("correct horse battery")).not.toBe(hash);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("rejects too short passwords and malformed hashes", async () => {
    await expect(hashPassword("short")).rejects.toThrow(RangeError);
    expect(await verifyPassword("whatever-password", "plaintext")).toBe(false);
    expect(await verifyPassword("whatever-password", "scrypt$1$1$1$a$b")).toBe(false);
    expect(
      await verifyPassword("whatever-password", "scrypt$99999999$8$1$c2FsdHNhbHQ$aGFzaA"),
    ).toBe(false);
  });
});
