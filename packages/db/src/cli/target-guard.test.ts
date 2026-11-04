import { describe, expect, it } from "vitest";

import { describeDatabaseUrl } from "../client";
import { assertTarget, CliUsageError, parseCliOptions, projectFingerprint } from "./target-guard";

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

  describe("Supabase project identity", () => {
    const STAGING = "abcdefghijklmnopqrst";
    const PRODUCTION = "zyxwvutsrqponmlkjihg";
    const pooler = (ref: string) =>
      describeDatabaseUrl(
        `postgresql://postgres.${ref}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      );

    it("reads the project ref from the pooler user or the direct host", () => {
      expect(pooler(STAGING).projectRef).toBe(STAGING);
      expect(
        describeDatabaseUrl(`postgresql://postgres:secret@db.${STAGING}.supabase.co:5432/postgres`)
          .projectRef,
      ).toBe(STAGING);
      expect(local.projectRef).toBeUndefined();
    });

    it("refuses a connection to another project than expected – without naming either", () => {
      const options = parseCliOptions(["--target", "staging", "--expect-project", STAGING]);
      expect(() => {
        assertTarget(options, pooler(STAGING), { requireProject: true });
      }).not.toThrow();
      let message = "";
      try {
        assertTarget(options, pooler(PRODUCTION), { requireProject: true });
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).toMatch(/does not point to the --expect-project project/);
      expect(message).not.toContain(STAGING);
      expect(message).not.toContain(PRODUCTION);
      expect(() => {
        assertTarget(options, remote, { requireProject: true });
      }).toThrow(CliUsageError);
    });

    it("requires --expect-project for remote targets where the command asks for it", () => {
      expect(() => {
        assertTarget(parseCliOptions(["--target", "staging"]), pooler(STAGING), {
          requireProject: true,
        });
      }).toThrow(/--expect-project/);
      expect(() => {
        assertTarget(parseCliOptions(["--target", "local"]), local, { requireProject: true });
      }).not.toThrow();
      expect(() => parseCliOptions(["--target", "staging", "--expect-project", "x"])).toThrow(
        CliUsageError,
      );
    });

    it("labels a project without revealing it", () => {
      const label = projectFingerprint(STAGING);
      expect(label).toMatch(/^[0-9a-f]{8}$/);
      expect(label).not.toBe(projectFingerprint(PRODUCTION));
      expect(projectFingerprint(undefined)).toBeUndefined();
    });
  });
});
