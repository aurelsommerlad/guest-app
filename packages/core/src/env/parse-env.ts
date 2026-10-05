import { type z } from "zod";

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Validates environment variables against a Zod schema.
 *
 * Fails fast with an error that lists every invalid variable by name only;
 * values are never included, so secrets cannot leak into logs.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined>,
): z.infer<TSchema> {
  // Treat empty strings like unset variables (common in .env files and CI).
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );

  const result = schema.safeParse(normalized);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      }),
    );
  }
  return result.data;
}
