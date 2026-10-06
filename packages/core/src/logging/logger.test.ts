import { describe, expect, it } from "vitest";

import { createLogger, type LogLevel } from "./logger";

function setup(level: LogLevel = "debug") {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger({
    level,
    now: () => new Date("2026-10-05T08:00:00.000Z"),
    sink: (entryLevel, line) =>
      lines.push({ level: entryLevel, entry: JSON.parse(line) as Record<string, unknown> }),
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes structured JSON entries", () => {
    const { logger, lines } = setup();
    logger.info("hello", { requestId: "r1" });
    expect(lines).toEqual([
      {
        level: "info",
        entry: { requestId: "r1", level: "info", msg: "hello", time: "2026-10-05T08:00:00.000Z" },
      },
    ]);
  });

  it("filters entries below the configured level", () => {
    const { logger, lines } = setup("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((line) => line.level)).toEqual(["warn", "error"]);
  });

  it("redacts sensitive keys, also nested", () => {
    const { logger, lines } = setup();
    logger.info("login", {
      guestToken: "abc",
      guest: { email: "laura@example.com", firstName: "Laura" },
      headers: { Authorization: "Bearer x" },
    });
    expect(lines[0]?.entry).toMatchObject({
      guestToken: "[REDACTED]",
      guest: { email: "[REDACTED]", firstName: "[REDACTED]" },
      headers: { Authorization: "[REDACTED]" },
    });
  });

  it("redacts registration data and access codes (Phase 11)", () => {
    const { logger, lines } = setup();
    logger.info("x", {
      birthDate: "1990-01-01",
      nationality: "DE",
      street: "Weg 1",
      postalCode: "87452",
      documentNumber: "X1",
      pin: "1234",
      accessCode: "1234",
      displayValue: "1234",
      mapping: "kept",
      registrationId: "kept",
    });
    expect(lines[0]?.entry).toMatchObject({
      birthDate: "[REDACTED]",
      nationality: "[REDACTED]",
      street: "[REDACTED]",
      postalCode: "[REDACTED]",
      documentNumber: "[REDACTED]",
      pin: "[REDACTED]",
      accessCode: "[REDACTED]",
      displayValue: "[REDACTED]",
      mapping: "kept",
      registrationId: "kept",
    });
  });

  it("child loggers carry bindings", () => {
    const { logger, lines } = setup();
    logger.child({ tenantId: "t1" }).child({ requestId: "r2" }).warn("x");
    expect(lines[0]?.entry).toMatchObject({ tenantId: "t1", requestId: "r2", msg: "x" });
  });

  it("serializes errors", () => {
    const { logger, lines } = setup();
    logger.error("failed", { err: new Error("boom") });
    expect(lines[0]?.entry["err"]).toMatchObject({ name: "Error", message: "boom" });
  });
});
