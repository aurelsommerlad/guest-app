/**
 * Error fields that are safe to log. Database errors can carry query parameters
 * (e.g. a reservation id) in their message, so messages are never logged here.
 */
export function safeErrorFields(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { name: "unknown" };
  const fields: Record<string, string> = { name: error.name };
  const cause: unknown = error.cause;
  const source = cause && typeof cause === "object" ? cause : error;
  if ("code" in source && typeof source.code === "string") fields["code"] = source.code;
  if ("kind" in error && typeof error.kind === "string") fields["kind"] = error.kind;
  return fields;
}
