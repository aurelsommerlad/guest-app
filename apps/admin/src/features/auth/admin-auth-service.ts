/**
 * Admin authentication (ADR 0014): e-mail + password, server-side sessions.
 * Same session pattern as guest access – opaque random secret in an HttpOnly cookie,
 * only its SHA-256 hash in the database, checked with the account on every request.
 * MFA can later be added as a second step between password check and session start.
 *
 * Never logged: passwords, e-mail addresses, session secrets, setup tokens.
 */
import {
  type AdminRole,
  constantTimeEquals,
  dummyPasswordHash,
  generateSecret,
  hashPassword,
  hashSecret,
  isWellFormedSecret,
  type Logger,
  PASSWORD_MAX_LENGTH,
  type PropertyScope,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@up/core";
import {
  acceptAdminInvitation,
  type AdminUser,
  countAdminUsers,
  createAdminSession,
  createAdminUser,
  type Database,
  findAdminSessionByTokenHash,
  findAdminUserByEmail,
  findOpenAdminInvitation,
  getTenantBySlug,
  hitRateLimit,
  normalizeAdminEmail,
  recordAdminLogin,
  revokeAdminSession,
} from "@up/db";

/** Absolute session lifetime – a working day; no silent extension. */
export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const LOGIN_LIMIT = { windowMs: 15 * 60 * 1000, perClient: 10, perAccount: 5 } as const;

export type AdminAuthDeps = { db: Database; logger: Logger; now: () => Date };
export type AdminSessionGrant = { secret: string; expiresAt: Date };
export type AdminContext = {
  adminUserId: string;
  tenantId: string;
  email: string;
  displayName?: string;
  /** Read from the database on every request – role changes apply immediately (M1). */
  role: AdminRole;
  propertyScope: PropertyScope;
  propertyIds: readonly string[];
};

export type LoginResult =
  { ok: true; session: AdminSessionGrant } | { ok: false; reason: "invalid" | "rate-limited" };

async function limited(
  deps: AdminAuthDeps,
  scope: string,
  value: string,
  max: number,
): Promise<boolean> {
  const bucket = await hitRateLimit(
    deps.db,
    `${scope}:${hashSecret(value)}`,
    LOGIN_LIMIT.windowMs,
    deps.now(),
  );
  return bucket.hits > max;
}

async function startSession(
  deps: AdminAuthDeps,
  user: Pick<AdminUser, "id" | "tenantId">,
  previousSecret: string | undefined,
): Promise<AdminSessionGrant> {
  const now = deps.now();
  if (previousSecret && isWellFormedSecret(previousSecret)) {
    await revokeAdminSession(deps.db, hashSecret(previousSecret), now);
  }
  const secret = generateSecret();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MAX_AGE_MS);
  const tenant = { tenantId: user.tenantId };
  await createAdminSession(deps.db, tenant, {
    adminUserId: user.id,
    tokenHash: hashSecret(secret),
    expiresAt,
  });
  await recordAdminLogin(deps.db, tenant, user.id, now);
  return { secret, expiresAt };
}

/** Same answer and similar timing for unknown accounts, wrong passwords and disabled users. */
export async function loginAdmin(
  deps: AdminAuthDeps,
  input: { email: string; password: string; clientAddress: string },
  previousSecret?: string,
): Promise<LoginResult> {
  const log = deps.logger.child({ flow: "admin-login" });
  try {
    const email = normalizeAdminEmail(input.email).slice(0, 254);
    const blockedClient = await limited(
      deps,
      "admin-login-client",
      input.clientAddress,
      LOGIN_LIMIT.perClient,
    );
    const blockedAccount = await limited(
      deps,
      "admin-login-account",
      email,
      LOGIN_LIMIT.perAccount,
    );
    if (blockedClient || blockedAccount) {
      log.warn("admin login rate limited");
      return { ok: false, reason: "rate-limited" };
    }
    const user = await findAdminUserByEmail(deps.db, email);
    const password = input.password.slice(0, PASSWORD_MAX_LENGTH);
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !valid || user.status !== "active") {
      log.info("admin login rejected");
      return { ok: false, reason: "invalid" };
    }
    const session = await startSession(deps, user, previousSecret);
    log.info("admin session started", { adminUserId: user.id });
    return { ok: true, session };
  } catch (error) {
    log.error("admin login failed", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return { ok: false, reason: "invalid" };
  }
}

export async function resolveAdminSession(
  deps: AdminAuthDeps,
  secret: string | undefined,
): Promise<AdminContext | undefined> {
  if (!secret || !isWellFormedSecret(secret)) return undefined;
  try {
    const record = await findAdminSessionByTokenHash(deps.db, hashSecret(secret), deps.now());
    if (!record) return undefined;
    return {
      adminUserId: record.user.id,
      tenantId: record.user.tenantId,
      email: record.user.email,
      ...(record.user.displayName ? { displayName: record.user.displayName } : {}),
      role: record.user.role,
      propertyScope: record.user.propertyScope,
      propertyIds: record.user.propertyIds,
    };
  } catch (error) {
    deps.logger.error("admin session lookup failed", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return undefined;
  }
}

export async function logoutAdmin(deps: AdminAuthDeps, secret: string | undefined): Promise<void> {
  if (secret && isWellFormedSecret(secret)) {
    await revokeAdminSession(deps.db, hashSecret(secret), deps.now());
  }
}

export type SetupResult =
  | { ok: true; session: AdminSessionGrant }
  | { ok: false; reason: "unavailable" | "invalid-token" | "invalid-input" | "rate-limited" };

/** Whether the one-time setup can be used at all (token configured, no admin exists). */
export async function isSetupAvailable(
  deps: AdminAuthDeps,
  configuredToken: string | undefined,
): Promise<boolean> {
  return Boolean(configuredToken) && (await countAdminUsers(deps.db)) === 0;
}

/**
 * Creates the very first admin account. Only possible while no admin account exists and
 * with the setup token from the server environment (ADMIN_SETUP_TOKEN).
 */
export async function setupFirstAdmin(
  deps: AdminAuthDeps,
  configuredToken: string | undefined,
  input: {
    setupToken: string;
    tenantSlug: string;
    email: string;
    password: string;
    clientAddress: string;
  },
): Promise<SetupResult> {
  const log = deps.logger.child({ flow: "admin-setup" });
  try {
    if (await limited(deps, "admin-setup-client", input.clientAddress, LOGIN_LIMIT.perAccount)) {
      return { ok: false, reason: "rate-limited" };
    }
    if (!configuredToken || (await countAdminUsers(deps.db)) > 0) {
      return { ok: false, reason: "unavailable" };
    }
    if (!constantTimeEquals(input.setupToken, configuredToken)) {
      log.warn("admin setup rejected", { reason: "token" });
      return { ok: false, reason: "invalid-token" };
    }
    const email = normalizeAdminEmail(input.email);
    const tenant = await getTenantBySlug(deps.db, input.tenantSlug.trim());
    if (
      !tenant ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      input.password.length < PASSWORD_MIN_LENGTH ||
      input.password.length > PASSWORD_MAX_LENGTH
    ) {
      return { ok: false, reason: "invalid-input" };
    }
    const user = await createAdminUser(
      deps.db,
      { tenantId: tenant.id },
      {
        email,
        passwordHash: await hashPassword(input.password),
        role: "owner",
      },
    );
    log.info("first admin account created", { adminUserId: user.id, tenantId: tenant.id });
    return { ok: true, session: await startSession(deps, user, undefined) };
  } catch (error) {
    log.error("admin setup failed", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return { ok: false, reason: "invalid-input" };
  }
}

/* ------------------------------------------------------------------------------------------
 * Invitations (M1): new team members set their own password via a one-time link.
 * No passwords are ever taken over from the Extras app.
 * ---------------------------------------------------------------------------------------- */

export type InvitationPreview = { role: AdminUser["role"]; email: string; expiresAt: Date };

/** What the invitation page may show – only for a well-formed, open, unexpired link. */
export async function previewInvitation(
  deps: AdminAuthDeps,
  token: string,
): Promise<InvitationPreview | undefined> {
  if (!isWellFormedSecret(token)) return undefined;
  const invitation = await findOpenAdminInvitation(deps.db, hashSecret(token), deps.now());
  return invitation
    ? { role: invitation.role, email: invitation.email, expiresAt: invitation.expiresAt }
    : undefined;
}

export type AcceptInvitationOutcome =
  | { ok: true; session: AdminSessionGrant }
  | { ok: false; reason: "invalid" | "invalid-password" | "rate-limited" | "already-member" };

export async function acceptInvitation(
  deps: AdminAuthDeps,
  input: { token: string; password: string; displayName?: string; clientAddress: string },
): Promise<AcceptInvitationOutcome> {
  const log = deps.logger.child({ flow: "admin-invitation" });
  try {
    if (await limited(deps, "admin-invite-client", input.clientAddress, LOGIN_LIMIT.perClient)) {
      return { ok: false, reason: "rate-limited" };
    }
    if (!isWellFormedSecret(input.token)) return { ok: false, reason: "invalid" };
    if (
      input.password.length < PASSWORD_MIN_LENGTH ||
      input.password.length > PASSWORD_MAX_LENGTH
    ) {
      return { ok: false, reason: "invalid-password" };
    }
    const result = await acceptAdminInvitation(deps.db, {
      tokenHash: hashSecret(input.token),
      passwordHash: await hashPassword(input.password),
      ...(input.displayName ? { displayName: input.displayName.slice(0, 120) } : {}),
      now: deps.now(),
    });
    if (!result.ok) {
      log.info("admin invitation rejected", { reason: result.reason });
      return result;
    }
    log.info("admin invitation accepted", { adminUserId: result.user.id });
    return { ok: true, session: await startSession(deps, result.user, undefined) };
  } catch (error) {
    log.error("admin invitation failed", {
      error: error instanceof Error ? { name: error.name } : "unknown",
    });
    return { ok: false, reason: "invalid" };
  }
}
