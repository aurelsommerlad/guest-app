/**
 * Extras ↔ STAY parity harness (M3 shadow operation).
 *
 *   pnpm --filter @up/shadow parity [--out <dir>]
 *
 * Runs the real Extras code (aurelsommerlad/guest-services lib/*.js, imported read-only from a
 * local checkout – EXTRAS_REPO, default ../guest-services) and the STAY engine against the same
 * guest-services Apaleo simulator, scenario by scenario, and writes a structured parity report
 * (JSON + Markdown). Safety:
 *   - the simulator replaces fetch for Apaleo and refuses every other host (Slack included);
 *   - KV and Slack variables are removed before anything is imported, Extras uses a throw-away
 *     local JSON store in a temporary directory;
 *   - STAY's gateway runs in mode "simulated"; its commands are applied to the simulator state;
 *   - the guest-services checkout is never written to.
 */
/* eslint-disable no-console -- command-line harness: progress output only, no data values */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createLogger } from "@up/core";
import {
  createServiceLockStore,
  createServiceRecordStore,
  createServiceWriteStore,
  importExtrasSnapshot,
  seedTenant,
  uniquePlacesSeed,
} from "@up/db";
import { createTestDatabase } from "@up/db/testing";
import {
  ApaleoClient,
  ApaleoServiceReader,
  ServiceBookingEngine,
  ServiceWriteGateway,
} from "@up/integrations";

import { compareScenario, type Deviation, type RunResult } from "./compare";
import { renderMarkdown } from "./report";
import { EXTENSION_CONFIG, EXTRAS_CATALOG, type Scenario, SCENARIOS } from "./scenarios";
import { applyToSimulator, readState, type SimState, statePath, writeState } from "./simulator-state";

type Obj = Record<string, unknown>;
const RESERVATION = "JTKQSYFX-1";
const CONTEXT = { tenantId: "unique-places", propertyId: "test-run", apaleoPropertyId: "TEST" };

const args = process.argv.slice(2);
const outDir = path.resolve(args[args.indexOf("--out") + 1] && args.includes("--out") ? (args[args.indexOf("--out") + 1] ?? ".") : path.join(import.meta.dirname, "../../../../docs/staging"));
const extrasRepo = path.resolve(process.env.EXTRAS_REPO ?? path.join(import.meta.dirname, "../../../../../guest-services"));

/* ── Isolation before any Extras module is loaded ─────────────────────────────────────── */
const work = fs.mkdtempSync(path.join(os.tmpdir(), "stay-parity-"));
for (const key of Object.keys(process.env)) {
  if (/^(KV_|SLACK_|UPSTASH_|DATABASE_URL|APALEO_SERVICE_WRITES)/.test(key)) Reflect.deleteProperty(process.env, key);
}
process.env.APALEO_SIM_STATE = path.join(work, "apaleo-sim.json");
process.env.APALEO_CLIENT_ID = "parity-simulated";
process.env.APALEO_CLIENT_SECRET = "parity-simulated";
process.chdir(work);

await import(path.join(extrasRepo, "test/support/apaleo-simulator.mjs"));
if (globalThis.fetch.name !== "simulatedFetch") throw new Error("Apaleo simulator is not active – aborting");

type ExtrasLib = {
  guest: {
    getGuestCatalog: (reservation: Obj, propertyId: string) => Promise<{ items: Obj[]; pastStay: boolean }>;
    placeGuestOrder: (input: Obj) => Promise<{ booked: Obj[]; failed: Obj[] }>;
    getStayExtensionOffer: (reservation: Obj) => Promise<Obj | null>;
    confirmStayExtension: (input: Obj) => Promise<Obj>;
  };
  requests: {
    createGuestRequest: (input: Obj) => Promise<Obj>;
    approveRequest: (id: string) => Promise<{ success: boolean; error?: string }>;
  };
  apaleo: { getReservationById: (id: string) => Promise<Obj> };
};
const extras: ExtrasLib = {
  guest: (await import(path.join(extrasRepo, "lib/guest.js"))) as ExtrasLib["guest"],
  requests: (await import(path.join(extrasRepo, "lib/requests.js"))) as ExtrasLib["requests"],
  apaleo: (await import(path.join(extrasRepo, "lib/apaleo.js"))) as ExtrasLib["apaleo"],
};

/* ── Simulator state per scenario ─────────────────────────────────────────────────────── */

async function seedState(scenario: Scenario): Promise<SimState> {
  process.env.APALEO_SIM_ARRIVAL = scenario.env?.arrival ?? "2027-01-12";
  process.env.APALEO_SIM_DEPARTURE = scenario.env?.departure ?? "2027-01-14";
  process.env.APALEO_SIM_STATUS = scenario.env?.status ?? "Confirmed";
  fs.rmSync(statePath(), { force: true });
  await fetch("https://api.apaleo.com/inventory/v1/unit-groups/TEST-IGL4"); // seeds the file
  const state = readState();
  scenario.mutate?.(state);
  state.calls = [];
  writeState(state);
  return structuredClone(state);
}

function snapshotState(): RunResult["state"] {
  const state = readState();
  const r = state.reservations[RESERVATION];
  return {
    departure: r?.departure.slice(0, 10) ?? null,
    adults: r?.adults ?? null,
    timeSlices: r?.timeSlices.map((t) => `${t.serviceDate}:${String(t.totalGrossAmount.amount)}`) ?? [],
    vehicle: r?.primaryGuest.vehicleRegistration?.number ?? null,
    comment: (r?.comment ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/^\[Gäste-Portal [^\]]*\]/, "[Gäste-Portal]")),
    services: (state.services[RESERVATION] ?? [])
      .map((s) => ({
        id: s.service.id,
        dates: s.dates.map((d) => `${d.serviceDate}×${String(d.count)}@${String(d.amount.grossAmount)}`),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    writes: state.calls
      // Token requests are authentication, not writes to the reservation.
      .filter((c) => c.method !== "GET" && !c.path.startsWith("/connect/token"))
      .map((c) => {
        // Same Apaleo call under STAY's command names: amend-occupancy/amend-stay → amend,
        // update-vehicle/append-comment → PATCH of the reservation.
        if (c.method.startsWith("SIM:"))
          return c.method.slice(4).replace(/update-vehicle|append-comment/, "patch").replace(/^amend-.*/, "amend");
        if (c.path.includes("/book-service")) return "book-service";
        if (c.path.includes("/amend")) return "amend";
        return c.method === "PATCH" ? "patch" : `${c.method} ${c.path}`;
      }),
  };
}

/* ── Extras run ───────────────────────────────────────────────────────────────────────── */

const EXTRAS_REASONS: Record<string, string> = {
  "nicht verfügbar": "not_available",
  "Apartmenttyp nicht erlaubt": "unit_group_restricted",
  "Diese Buchung wird bereits verarbeitet.": "in_progress",
  "Diese Änderung wird bereits verarbeitet.": "in_progress",
  vehicle_registration_update_failed: "vehicle_registration_failed",
};
const EXTRAS_APPROVAL_ERRORS: Record<string, string> = {
  "Diese Anfrage wird bereits bearbeitet.": "in_progress",
  "Der Aufenthalt liegt bereits in der Vergangenheit.": "past_stay",
  "Dieser Service wird für die Reservierung nicht mehr angeboten.": "no_offer",
  "Dieses Extra ist im Katalog nicht mehr aktiv.": "inactive",
  "Dieses Extra ist für den gebuchten Apartmenttyp nicht verfügbar.": "unit_group_restricted",
  "Für diese Buchung ist keine weitere Person mehr möglich.": "capacity_exceeded",
  "Das erforderliche Datum ist für diesen Service nicht mehr verfügbar.": "incomplete_dates",
  "Das angefragte Datum ist nicht mehr verfügbar.": "requested_date_unavailable",
  "Nicht genügend Verfügbarkeit für die angefragte Menge.": "insufficient_availability",
  "Diese Anfrage wurde bereits bearbeitet.": "not_pending",
};

async function runExtras(scenario: Scenario, catalog: Record<string, Obj>, config: Obj): Promise<RunResult> {
  fs.mkdirSync(path.join(work, ".data"), { recursive: true });
  fs.writeFileSync(
    path.join(work, ".data/db.json"),
    JSON.stringify({ "catalog:TEST:items": catalog, "extension-night:config:TEST": config }),
  );
  const steps: RunResult["steps"] = [];
  for (const step of scenario.steps) {
    const reservation = await extras.apaleo.getReservationById(RESERVATION);
    if (step.kind === "catalog") {
      const result = await extras.guest.getGuestCatalog(reservation, "TEST");
      steps.push({ kind: "catalog", value: { pastStay: result.pastStay, items: result.items } });
    } else if (step.kind === "extension-offer") {
      steps.push({ kind: "extension-offer", value: await extras.guest.getStayExtensionOffer(reservation) });
    } else if (step.kind === "order") {
      const result = await extras.guest.placeGuestOrder({ reservation, propertyId: "TEST", lines: step.lines, guestName: "Parity" });
      steps.push({
        kind: "order",
        value: {
          booked: result.booked.map((b) => `${String(b.serviceId)}×${String(b.count)}`),
          failed: result.failed.map((f) => `${String(f.serviceId)}:${EXTRAS_REASONS[String(f.reason)] ?? String(f.reason)}`),
        },
      });
    } else if (step.kind === "extend") {
      const offer = await extras.guest.getStayExtensionOffer(reservation);
      try {
        const result = await extras.guest.confirmStayExtension({
          reservationId: RESERVATION,
          expectedCurrentDeparture: (offer?.currentDeparture) ?? "",
        });
        const records = JSON.parse(fs.readFileSync(path.join(work, ".data/db.json"), "utf8")) as Obj;
        const stored = Object.values((records["stay-extensions:records"] ?? {}) as Obj)[0] as Obj | undefined;
        steps.push({ kind: "extend", value: { ok: true, newDeparture: result.newDeparture, extensionPrice: result.extensionPrice, status: stored?.status ?? null } });
      } catch (error) {
        steps.push({ kind: "extend", value: { ok: false, reason: (error as { reason?: string }).reason ?? "error" } });
      }
    } else {
      const { items } = await extras.guest.getGuestCatalog(reservation, "TEST");
      const item = items.find((i) => i.serviceId === step.serviceId && i.fulfillmentMode === "request");
      if (!item) {
        steps.push({ kind: "request", value: { created: false } });
        continue;
      }
      const record = await extras.requests.createGuestRequest({ reservation, propertyId: "TEST", item, quantity: step.quantity, guestName: "Parity" });
      const approval = step.approve ? await extras.requests.approveRequest(String(record.requestId)) : null;
      steps.push({
        kind: "request",
        value: {
          created: true,
          requestedDates: record.requestedServiceDates,
          quoted: record.displayedPrice,
          approval: approval ? (approval.success ? "ok" : (EXTRAS_APPROVAL_ERRORS[approval.error ?? ""] ?? approval.error ?? "error")) : null,
        },
      });
    }
  }
  return { steps, state: snapshotState() };
}

/* ── STAY run ─────────────────────────────────────────────────────────────────────────── */

async function runStay(scenario: Scenario, catalog: Record<string, Obj>, config: Obj): Promise<RunResult & { importWarnings: string[] }> {
  const test = await createTestDatabase();
  try {
    await seedTenant(test.db, uniquePlacesSeed);
    await test.client.query(
      `INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
       VALUES ('test-run', 'unique-places', 'test-run', 'Test run', 'Test run', 'Testumgebung', 'Europe/Berlin')`,
    );
    await test.client.query(
      `INSERT INTO external_mappings (tenant_id, provider, entity_type, internal_entity_id, external_id)
       VALUES ('unique-places', 'apaleo', 'property', 'test-run', 'TEST')`,
    );
    const ownerId =
      (
        await test.client.query<{ id: string }>(
          `INSERT INTO admin_users (tenant_id, email, password_hash, role) VALUES ('unique-places', 'parity@example.test', 'scrypt$x', 'owner') RETURNING id`,
        )
      ).rows[0]?.id ?? "";
    // Extras data reaches STAY only through the M1 import (snapshot → import), as in production.
    const imported = await importExtrasSnapshot(
      test.db,
      { tenantId: CONTEXT.tenantId },
      {
        entries: [
          { key: "catalog:TEST:items", type: "hash", value: catalog },
          { key: "extension-night:config:TEST", type: "string", value: config },
        ],
      },
      { mode: "apply", snapshotSha256: "0".repeat(64), actorAdminId: ownerId, now: new Date() },
    );
    const importWarnings = imported.items.flatMap((i) => (i.warnings ?? []).map((w) => `${i.sourceKey}:${w}`));

    const client = new ApaleoClient({
      clientId: "parity-simulated",
      clientSecret: "parity-simulated",
      logger: createLogger({ sink: () => undefined }),
      retryDelayMs: 0,
      // Token locally (the simulator's token answer lacks token_type); API calls go to the simulator.
      fetch: (input, init) =>
        String(input instanceof Request ? input.url : input).startsWith("https://identity.apaleo.com")
          ? Promise.resolve(Response.json({ access_token: "simulated", expires_in: 3600, token_type: "Bearer" }))
          : globalThis.fetch(input, init),
    });
    const reader = new ApaleoServiceReader(client);
    const engine = new ServiceBookingEngine({
      reader,
      gateway: new ServiceWriteGateway({
        mode: "simulated",
        allowedApaleoPropertyIds: ["TEST"],
        store: createServiceWriteStore(test.db),
        lookupReservation: (id) => reader.getReservation(id),
        onSimulated: applyToSimulator,
      }),
      records: createServiceRecordStore(test.db),
      locks: createServiceLockStore(test.db),
      verifySimulatedWrites: "check",
    });

    const steps: RunResult["steps"] = [];
    let n = 0;
    for (const step of scenario.steps) {
      n += 1;
      const reservation = await reader.getReservation(RESERVATION);
      if (step.kind === "catalog") {
        const result = await engine.getGuestCatalog(CONTEXT, reservation, { includeUnpublished: true });
        steps.push({ kind: "catalog", value: { pastStay: result.pastStay, items: result.items, hidden: result.hidden } });
      } else if (step.kind === "extension-offer") {
        steps.push({ kind: "extension-offer", value: await engine.getStayExtensionOffer(CONTEXT, RESERVATION) });
      } else if (step.kind === "order") {
        await test.client.query(`UPDATE offers SET status = 'published'`); // shadow: imported drafts count as released
        const result = await engine.placeOrder(CONTEXT, { reservationId: RESERVATION, idempotencyKey: `parity-${scenario.id}-${String(n)}`, lines: step.lines });
        steps.push({
          kind: "order",
          value:
            result.status === "in_progress"
              ? { booked: [], failed: ["in_progress"] }
              : {
                  booked: result.booked.map((b) => `${b.serviceId}×${String(b.count)}`),
                  failed: result.failed.map((f) => `${f.serviceId}:${f.reason}`),
                },
        });
      } else if (step.kind === "extend") {
        const offer = await engine.getStayExtensionOffer(CONTEXT, RESERVATION);
        const result = await engine.confirmStayExtension(CONTEXT, { reservationId: RESERVATION, expectedCurrentDeparture: offer?.currentDeparture ?? "" });
        steps.push({
          kind: "extend",
          value: result.ok
            ? { ok: true, newDeparture: result.newDeparture, extensionPrice: result.extensionPrice, status: result.status }
            : { ok: false, reason: result.reason },
        });
      } else {
        await test.client.query(`UPDATE offers SET status = 'published'`);
        const created = await engine.createRequest(CONTEXT, { reservationId: RESERVATION, serviceId: step.serviceId, quantity: step.quantity });
        if (!created.ok) {
          steps.push({ kind: "request", value: { created: false } });
          continue;
        }
        const row = await test.client.query<{ requested_dates: string[]; quoted_cents: number | null }>(
          `SELECT requested_dates::text[] AS requested_dates, quoted_cents FROM offer_requests WHERE id = $1`,
          [created.requestId],
        );
        const approval = step.approve ? await engine.approveRequest(CONTEXT, created.requestId, ownerId) : null;
        steps.push({
          kind: "request",
          value: {
            created: true,
            requestedDates: row.rows[0]?.requested_dates ?? [],
            quoted: row.rows[0]?.quoted_cents === null || row.rows[0]?.quoted_cents === undefined ? null : row.rows[0].quoted_cents / 100,
            approval: approval ? (approval.ok ? "ok" : approval.reason) : null,
          },
        });
      }
    }
    return { steps, state: snapshotState(), importWarnings };
  } finally {
    await test.close();
  }
}

/* ── Main ─────────────────────────────────────────────────────────────────────────────── */

const results: { scenario: Scenario; deviations: Deviation[]; importWarnings: string[]; extras: RunResult; stay: RunResult }[] = [];
for (const scenario of SCENARIOS) {
  const catalog = structuredClone(EXTRAS_CATALOG);
  scenario.catalog?.(catalog);
  const config = scenario.extensionConfig ?? EXTENSION_CONFIG;
  const seed = await seedState(scenario);
  const extrasRun = await runExtras(scenario, catalog, config);
  writeState(seed);
  const stayRun = await runStay(scenario, catalog, config);
  const deviations = compareScenario(scenario.id, extrasRun, stayRun);
  results.push({ scenario, deviations, importWarnings: stayRun.importWarnings, extras: extrasRun, stay: stayRun });
  console.log(`${scenario.id} ${scenario.title}: ${deviations.length ? `${String(deviations.length)} Abweichung(en)` : "identisch"}`);
}

const report = {
  format: "stay-extras-parity/1",
  createdAt: new Date().toISOString(),
  extrasSource: "aurelsommerlad/guest-services (lokaler Checkout, nur gelesen)",
  apaleo: "guest-services test/support/apaleo-simulator.mjs (Apaleo TEST, Stand 08.11.2026) – kein Apaleo-Zugriff",
  gatewayMode: "simulated",
  scenarios: results.map((r) => ({
    id: r.scenario.id,
    title: r.scenario.title,
    identical: r.deviations.length === 0,
    deviations: r.deviations,
    importWarnings: r.importWarnings,
    extras: r.extras,
    stay: r.stay,
  })),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "extras-migration-m3-paritaet.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "extras-migration-m3-paritaet-lauf.md"), renderMarkdown(report));
fs.rmSync(work, { recursive: true, force: true });
console.log(`Bericht: ${outDir}`);
