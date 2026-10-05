import { describe, expect, it } from "vitest";

import { describeDatabaseUrl } from "../client";
import { assertTarget, CliUsageError, parseCliOptions } from "./target-guard";

const local = describeDatabaseUrl("postgres://postgres:secret@localhost:54322/postgres");
const remote = describeDatabaseUrl(
  "postgresql://postgres.ref:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
);

describe("database target guard", () => {
  it("describes a connection without credentials", () => {
    expect(remote).toEqual({
      host: "aws-0-eu-central-1.pooler.supabase.com",
      port: "5432",
      database: "postgres",
      isLocal: false,
    });
    expect(JSON.stringify(remote)).not.toContain("secret");
    expect(local.isLocal).toBe(true);
  });

  it("rejects non-postgres URLs without echoing them", () => {
    expect(() => describeDatabaseUrl("mysql://user:secret@host/db")).toThrow(/scheme/);
    expect(() => describeDatabaseUrl("not a url secret")).toThrow(
      "DATABASE_URL is not a valid URL",
    );
  });

  it("requires an explicit target", () => {
    expect(() => parseCliOptions([])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["--target", "prod"])).toThrow(CliUsageError);
    expect(parseCliOptions(["--target", "staging"])).toEqual({
      target: "staging",
      confirmProduction: false,
    });
  });

  it("matches the target to the connection", () => {
    expect(() => {
      assertTarget(parseCliOptions(["--target", "local"]), local);
    }).not.toThrow();
    expect(() => {
      assertTarget(parseCliOptions(["--target", "local"]), remote);
    }).toThrow(/localhost/);
    expect(() => {
      assertTarget(parseCliOptions(["--target", "staging"]), local);
    }).toThrow(/localhost/);
    expect(() => {
      assertTarget(parseCliOptions(["--target", "staging"]), remote);
    }).not.toThrow();
  });

  it("requires explicit confirmation for production", () => {
    expect(() => {
      assertTarget(parseCliOptions(["--target", "production"]), remote);
    }).toThrow(/--confirm-production/);
    expect(() => {
      assertTarget(parseCliOptions(["--target", "production", "--confirm-production"]), remote);
    }).not.toThrow();
  });
});
