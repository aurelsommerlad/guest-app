import { type DatabaseTarget } from "../client";

export const DB_TARGETS = ["local", "staging", "production"] as const;
export type DbTarget = (typeof DB_TARGETS)[number];

export type CliOptions = { target: DbTarget; confirmProduction: boolean };

export class CliUsageError extends Error {
  override name = "CliUsageError";
}

export function parseCliOptions(args: readonly string[]): CliOptions {
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  if (!target || !(DB_TARGETS as readonly string[]).includes(target)) {
    throw new CliUsageError("--target local|staging|production is required");
  }
  return {
    target: target as DbTarget,
    confirmProduction: args.includes("--confirm-production"),
  };
}

/**
 * Never touch a database by accident: the declared target must match the connection.
 * - local: only localhost
 * - staging / production: never localhost (TLS is enforced by createDatabase)
 * - production: additionally requires --confirm-production
 */
export function assertTarget(options: CliOptions, connection: DatabaseTarget): void {
  if (options.target === "local" && !connection.isLocal) {
    throw new CliUsageError("--target local requires a localhost DATABASE_URL");
  }
  if (options.target !== "local" && connection.isLocal) {
    throw new CliUsageError(`--target ${options.target} must not point to localhost`);
  }
  if (options.target === "production" && !options.confirmProduction) {
    throw new CliUsageError("--target production requires --confirm-production");
  }
}
