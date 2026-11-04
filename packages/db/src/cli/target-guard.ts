import { createHash } from "node:crypto";

import { type DatabaseTarget } from "../client";

export const DB_TARGETS = ["local", "staging", "production"] as const;
export type DbTarget = (typeof DB_TARGETS)[number];

export type CliOptions = {
  target: DbTarget;
  confirmProduction: boolean;
  /** Supabase project ref the operator expects DATABASE_URL to point to. */
  expectProject?: string;
};

export class CliUsageError extends Error {
  override name = "CliUsageError";
}

const PROJECT_REF = /^[a-z0-9]{20}$/;

export function parseCliOptions(args: readonly string[]): CliOptions {
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  if (!target || !(DB_TARGETS as readonly string[]).includes(target)) {
    throw new CliUsageError("--target local|staging|production is required");
  }
  const projectIndex = args.indexOf("--expect-project");
  const expectProject = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
  if (projectIndex >= 0 && (!expectProject || !PROJECT_REF.test(expectProject))) {
    throw new CliUsageError("--expect-project needs a Supabase project ref (20 characters)");
  }
  return {
    target: target as DbTarget,
    confirmProduction: args.includes("--confirm-production"),
    ...(expectProject ? { expectProject } : {}),
  };
}

/**
 * Never touch a database by accident: the declared target must match the connection.
 * - local: only localhost
 * - staging / production: never localhost (TLS is enforced by createDatabase)
 * - production: additionally requires --confirm-production
 * - --expect-project (required for remote targets where `requireProject` is set): the
 *   Supabase project of DATABASE_URL must be exactly that project
 */
export function assertTarget(
  options: CliOptions,
  connection: DatabaseTarget,
  { requireProject = false }: { requireProject?: boolean } = {},
): void {
  if (options.target === "local" && !connection.isLocal) {
    throw new CliUsageError("--target local requires a localhost DATABASE_URL");
  }
  if (options.target !== "local" && connection.isLocal) {
    throw new CliUsageError(`--target ${options.target} must not point to localhost`);
  }
  if (options.target === "production" && !options.confirmProduction) {
    throw new CliUsageError("--target production requires --confirm-production");
  }
  if (options.target !== "local" && requireProject && !options.expectProject) {
    throw new CliUsageError(`--target ${options.target} requires --expect-project <ref>`);
  }
  if (options.expectProject && connection.projectRef !== options.expectProject) {
    // Neither ref is echoed: the message alone must not reveal another project.
    throw new CliUsageError("DATABASE_URL does not point to the --expect-project project");
  }
}

/**
 * Short, non-reversible label of a Supabase project (first 8 hex of SHA-256 of the ref).
 * The CLI and the app's health endpoint print it, so an operator can see that both talk
 * to the same database without either revealing the project.
 */
export function projectFingerprint(projectRef: string | undefined): string | undefined {
  return projectRef ? createHash("sha256").update(projectRef).digest("hex").slice(0, 8) : undefined;
}
