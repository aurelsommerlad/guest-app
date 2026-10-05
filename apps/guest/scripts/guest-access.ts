/**
 * Development/test CLI for guest access (ADR 0011) – there is deliberately no web UI
 * for creating links.
 *
 *   DATABASE_URL=… pnpm guest-access:create --target local|staging|production
 *       --tenant unique-places --provider mock|apaleo --reservation <id>
 *       [--locale de|en] [--base-url https://…] [--valid-days N] [--confirm-production]
 *   DATABASE_URL=… pnpm guest-access:revoke --target … --tenant … --provider … --reservation …
 *
 * The plaintext link is printed exactly once and never stored or logged; only the
 * token's SHA-256 hash is written. Apaleo needs APALEO_CLIENT_ID/APALEO_CLIENT_SECRET
 * in the shell. Production requires --confirm-production, never mock data or --valid-days.
 */
/* eslint-disable no-console -- CLI output */
import {
  computeAccessWindow,
  createLogger,
  generateSecret,
  hashSecret,
  isExternalProvider,
  isReservationProvider,
  type PmsProvider,
  type ReservationProvider,
} from "@up/core";
import {
  assertDatabaseTarget,
  CliUsageError,
  createDatabase,
  createGuestAccess,
  describeDatabaseUrl,
  getTenantBySlug,
  parseDatabaseCliOptions,
  resolveExternalMapping,
  revokeGuestAccessForReservation,
} from "@up/db";
import { createApaleoProvider } from "@up/integrations";

import { createMockPms } from "../src/mocks/stay/mock-pms";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCALES = ["de", "en"];

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function required(args: readonly string[], name: string): string {
  const value = argument(args, name);
  if (!value) throw new CliUsageError(`--${name} is required`);
  return value;
}

function pmsFor(provider: ReservationProvider, now: Date): PmsProvider {
  if (provider === "mock") return createMockPms(now);
  const clientId = process.env["APALEO_CLIENT_ID"];
  const clientSecret = process.env["APALEO_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new CliUsageError("APALEO_CLIENT_ID and APALEO_CLIENT_SECRET must be set for apaleo");
  }
  return createApaleoProvider({
    clientId,
    clientSecret,
    logger: createLogger({
      level: "warn",
      sink: (_level, line) => {
        console.error(line);
      },
    }),
  });
}

function baseUrlFor(target: string, args: readonly string[]): string {
  const value = argument(args, "base-url") ?? process.env["NEXT_PUBLIC_APP_URL"];
  if (value) return value.replace(/\/+$/, "");
  if (target === "local") return "http://localhost:3000";
  throw new CliUsageError("--base-url is required for staging and production");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "create" && command !== "revoke") {
    throw new CliUsageError("command must be create or revoke");
  }
  const options = parseDatabaseCliOptions(args);
  const url = process.env["DATABASE_URL"];
  if (!url) throw new CliUsageError("DATABASE_URL is not set");
  const target = describeDatabaseUrl(url);
  assertDatabaseTarget(options, target);

  const tenantSlug = required(args, "tenant");
  const provider = required(args, "provider");
  const reservationId = required(args, "reservation");
  if (!isReservationProvider(provider))
    throw new CliUsageError("--provider must be apaleo or mock");
  const production = options.target === "production";
  if (production && provider === "mock") {
    throw new CliUsageError("mock reservations are not allowed in production");
  }
  const validDays = argument(args, "valid-days");
  if (validDays && production) throw new CliUsageError("--valid-days is not allowed in production");
  const locale = argument(args, "locale") ?? "de";
  if (!LOCALES.includes(locale)) throw new CliUsageError("--locale must be de or en");

  console.log(`→ guest-access ${command} on ${options.target}: ${target.host}/${target.database}`);
  const { db, close } = createDatabase(url, { maxConnections: 1 });
  try {
    const tenant = await getTenantBySlug(db, tenantSlug);
    if (!tenant) throw new CliUsageError("unknown tenant");
    const context = { tenantId: tenant.id };
    const now = new Date();

    if (command === "revoke") {
      const count = await revokeGuestAccessForReservation(
        db,
        context,
        { provider, externalReservationId: reservationId },
        now,
      );
      console.log(`✓ revoked ${count} guest access record(s); their sessions end immediately`);
      return;
    }

    const reservation = await pmsFor(provider, now).getReservation(reservationId);
    if (reservation.status === "canceled" || reservation.status === "no-show") {
      throw new CliUsageError("the reservation is not active");
    }
    if (!isExternalProvider(reservation.provider)) throw new CliUsageError("unknown id provider");
    const propertyId = await resolveExternalMapping(db, context, {
      provider: reservation.provider,
      entityType: "property",
      externalId: reservation.externalPropertyId,
    });
    if (!propertyId) {
      throw new CliUsageError("the reservation's property is not mapped for this tenant (seed?)");
    }
    const unitId = reservation.externalUnitId
      ? await resolveExternalMapping(db, context, {
          provider: reservation.provider,
          entityType: "unit",
          externalId: reservation.externalUnitId,
        })
      : undefined;

    const window = validDays
      ? { validFrom: now, validUntil: new Date(now.getTime() + Number(validDays) * DAY_MS) }
      : computeAccessWindow(reservation);
    if (Number.isNaN(window.validUntil.getTime()) || window.validUntil <= now) {
      throw new CliUsageError("the access window is already over (use --valid-days for tests)");
    }

    const token = generateSecret();
    const access = await createGuestAccess(db, context, {
      propertyId,
      ...(unitId ? { unitId } : {}),
      reservationProvider: provider,
      externalReservationId: reservation.externalId,
      tokenHash: hashSecret(token),
      ...window,
    });

    console.log(`✓ guest access ${access.id}`);
    console.log(`  valid ${window.validFrom.toISOString()} → ${window.validUntil.toISOString()}`);
    console.log("  Link (shown once – it cannot be recovered):");
    console.log(`  ${baseUrlFor(options.target, args)}/${locale}/s/${token}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  // Messages never contain the connection string, tokens or guest data.
  const message =
    error instanceof CliUsageError
      ? error.message
      : error instanceof Error
        ? error.name
        : "unknown error";
  console.error(`✗ ${message}`);
  process.exitCode = 1;
});
