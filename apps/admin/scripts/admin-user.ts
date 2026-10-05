/**
 * Creates an admin account (local development or wherever a direct database connection
 * exists). In environments without one (e.g. Supabase from Claude Cloud) use the one-time
 * /setup page instead.
 *
 *   DATABASE_URL=… ADMIN_PASSWORD=… pnpm admin-user:create --target local|staging|production
 *       --tenant unique-places --email name@example.com [--confirm-production]
 *
 * The password is read from ADMIN_PASSWORD (never from arguments, so it stays out of the
 * shell history and process list) and stored only as a scrypt hash.
 */
/* eslint-disable no-console -- CLI output */
import { hashPassword, PASSWORD_MIN_LENGTH } from "@up/core";
import {
  assertDatabaseTarget,
  CliUsageError,
  createAdminUser,
  createDatabase,
  describeDatabaseUrl,
  getTenantBySlug,
  parseDatabaseCliOptions,
} from "@up/db";

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseDatabaseCliOptions(args);
  const url = process.env["DATABASE_URL"];
  if (!url) throw new CliUsageError("DATABASE_URL is not set");
  const target = describeDatabaseUrl(url);
  assertDatabaseTarget(options, target);
  const tenantSlug = argument(args, "tenant");
  const email = argument(args, "email");
  const password = process.env["ADMIN_PASSWORD"];
  if (!tenantSlug || !email) throw new CliUsageError("--tenant and --email are required");
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new CliUsageError(
      `ADMIN_PASSWORD must be set (at least ${PASSWORD_MIN_LENGTH} characters)`,
    );
  }

  console.log(`→ admin-user create on ${options.target}: ${target.host}/${target.database}`);
  const { db, close } = createDatabase(url, { maxConnections: 1 });
  try {
    const tenant = await getTenantBySlug(db, tenantSlug);
    if (!tenant) throw new CliUsageError("unknown tenant");
    const user = await createAdminUser(
      db,
      { tenantId: tenant.id },
      {
        email,
        passwordHash: await hashPassword(password),
      },
    );
    console.log(`✓ admin account ${user.id} (${user.email}) for tenant ${tenant.slug}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof CliUsageError
      ? error.message
      : error instanceof Error
        ? error.name
        : "unknown error";
  console.error(`✗ ${message}`);
  process.exitCode = 1;
});
