import { constantTimeEquals } from "@up/core";

/** "Authorization: Bearer <secret>" check in constant time; no secret configured → never. */
export function isAuthorizedCronRequest(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  return constantTimeEquals(header ?? "", `Bearer ${secret}`);
}
