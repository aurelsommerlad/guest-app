/**
 * Own account (M3): password change. Checks the current password, the minimum length and the
 * confirmation, rate-limits attempts per account, then stores the new hash and ends every
 * other session of the user (the current one stays). Passwords are never logged.
 */
import {
  hashPassword,
  hashSecret,
  isWellFormedSecret,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@up/core";
import { changeAdminPassword, findAdminUserByEmail, hitRateLimit } from "@up/db";

import { type AdminAuthDeps, type AdminContext } from "../auth/admin-auth-service";

export type PasswordChangeInput = { current: string; next: string; confirm: string };
export type PasswordChangeResult =
  | { ok: true; revokedSessions: number }
  | { ok: false; error: string };

const LIMIT = { windowMs: 15 * 60 * 1000, max: 5 } as const;

export async function changeOwnPassword(
  deps: AdminAuthDeps,
  admin: AdminContext,
  input: PasswordChangeInput,
  currentSecret: string | undefined,
): Promise<PasswordChangeResult> {
  const log = deps.logger.child({ flow: "admin-password-change" });
  const bucket = await hitRateLimit(
    deps.db,
    `admin-password:${hashSecret(admin.adminUserId)}`,
    LIMIT.windowMs,
    deps.now(),
  );
  if (bucket.hits > LIMIT.max)
    return { ok: false, error: "Zu viele Versuche. Bitte versuche es in 15 Minuten erneut." };
  const next = input.next.slice(0, PASSWORD_MAX_LENGTH);
  if (next.length < PASSWORD_MIN_LENGTH)
    return {
      ok: false,
      error: `Das neue Passwort braucht mindestens ${String(PASSWORD_MIN_LENGTH)} Zeichen.`,
    };
  if (next !== input.confirm.slice(0, PASSWORD_MAX_LENGTH))
    return { ok: false, error: "Die beiden neuen Passwörter stimmen nicht überein." };
  const user = await findAdminUserByEmail(deps.db, admin.email);
  const valid =
    user?.id === admin.adminUserId &&
    (await verifyPassword(input.current.slice(0, PASSWORD_MAX_LENGTH), user.passwordHash));
  if (!user || !valid) {
    log.info("password change rejected");
    return { ok: false, error: "Das aktuelle Passwort ist nicht korrekt." };
  }
  if (await verifyPassword(next, user.passwordHash))
    return { ok: false, error: "Das neue Passwort muss sich vom bisherigen unterscheiden." };
  const { revokedSessions } = await changeAdminPassword(
    deps.db,
    { tenantId: admin.tenantId },
    {
      adminUserId: admin.adminUserId,
      passwordHash: await hashPassword(next),
      keepTokenHash: currentSecret && isWellFormedSecret(currentSecret) ? hashSecret(currentSecret) : null,
      now: deps.now(),
    },
  );
  log.info("password changed", { adminUserId: admin.adminUserId, revokedSessions });
  return { ok: true, revokedSessions };
}
