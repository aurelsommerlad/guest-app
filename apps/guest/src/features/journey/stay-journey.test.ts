import { type AccessCredential, type AccessProvider, createLogger } from "@up/core";
import { type Database, saveJourneySettings, seedTenant, uniquePlacesSeed } from "@up/db";
import { createTestDatabase, type TestDatabase } from "@up/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmTrip, saveGuestStep, submitCheckIn } from "../check-in/check-in-service";
import { guestContext, testRegistrationConfig } from "../check-in/test-context";
import { loadStayJourney } from "./stay-journey";

let test: TestDatabase;
let db: Database;
const logger = createLogger({ sink: () => undefined });
const up = { tenantId: "unique-places" };
const ARRIVAL_DAY = new Date("2026-08-27T11:00:00+02:00");

const credential: AccessCredential = {
  type: "keybox",
  status: "active",
  validFrom: "2026-08-27T16:00:00+02:00",
  validUntil: "2026-08-31T10:00:00+02:00",
  displayValue: "2580",
  provider: "keybox",
};

function provider() {
  const getCredential = vi.fn(() => Promise.resolve<AccessCredential | undefined>(credential));
  const access: AccessProvider = { name: "keybox", getCredential };
  return Object.assign(access, { spy: getCredential });
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  await seedTenant(db, uniquePlacesSeed);
});

afterEach(async () => {
  await test.close();
});

describe("stay journey", () => {
  it("defaults to no check-in and manual access for an unconfigured property", async () => {
    const journey = await loadStayJourney(
      { db, logger, accessProvider: provider() },
      guestContext({ now: ARRIVAL_DAY }),
    );
    expect(journey?.journey).toEqual({
      phase: "arrival-day",
      registration: "not-required",
      access: "manual",
      primaryAction: "check-in-info",
    });
  });

  it("gates the key box code by registration where configured and reveals it only on request", async () => {
    await saveJourneySettings(db, up, "hov", {
      registration: testRegistrationConfig,
      access: { mode: "keybox", release: "arrival-day", requiresCompletedRegistration: true },
    });
    const access = provider();
    const deps = { db, logger, accessProvider: access };
    const context = guestContext({ now: ARRIVAL_DAY });

    const blocked = await loadStayJourney(deps, context, { includeAccessCode: true });
    expect(blocked?.access).toEqual({ status: "pending", reason: "registration-required" });
    expect(blocked?.journey.primaryAction).toBe("online-check-in");
    expect(access.spy).not.toHaveBeenCalled();

    // Complete the check-in.
    const checkInDeps = { db, logger, now: () => ARRIVAL_DAY };
    await confirmTrip(checkInDeps, context);
    await saveGuestStep(checkInDeps, context, {
      step: "guests",
      version: 1,
      values: {
        0: {
          firstName: "Laura",
          lastName: "Muster",
          email: "laura@example.com",
          phone: "+491701234567",
          birthDate: "1990-05-17",
          nationality: "DE",
        },
        1: {
          firstName: "Tom",
          lastName: "Muster",
          phone: "+436641234567",
          birthDate: "1988-01-01",
          nationality: "AT",
        },
      },
    });
    await saveGuestStep(checkInDeps, context, {
      step: "address",
      version: 2,
      values: { 0: { street: "Seeweg 3", postalCode: "88131", city: "Lindau", country: "DE" } },
    });
    expect(
      await submitCheckIn(checkInDeps, context, { version: 3, confirmed: true }),
    ).toMatchObject({ ok: true });

    const shown = await loadStayJourney(deps, context);
    expect(shown?.access).toMatchObject({ status: "available", credential: { type: "keybox" } });
    expect(JSON.stringify(shown?.access)).not.toContain("2580");
    expect(shown?.journey.primaryAction).toBe("show-access");
    const revealed = await loadStayJourney(deps, context, { includeAccessCode: true });
    expect(revealed?.access).toMatchObject({ credential: { displayValue: "2580" } });
    // The request to the access system carries ids only.
    expect(access.spy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "unique-places", propertyId: "hov", unitId: "ros" }),
    );
  });

  it("does not release access before the arrival day", async () => {
    await saveJourneySettings(db, up, "hov", {
      registration: { ...testRegistrationConfig, enabled: false },
      access: { mode: "keybox", release: "arrival-day", requiresCompletedRegistration: false },
    });
    const access = provider();
    const journey = await loadStayJourney({ db, logger, accessProvider: access }, guestContext());
    expect(journey?.access).toMatchObject({ status: "pending", reason: "not-yet-released" });
    expect(access.spy).not.toHaveBeenCalled();
  });

  it("degrades to manual access when the database or the access system fails", async () => {
    const broken = {
      select: () => {
        throw new Error("connection lost");
      },
    } as unknown as Database;
    const journey = await loadStayJourney(
      { db: broken, logger, accessProvider: provider() },
      guestContext({ now: ARRIVAL_DAY }),
    );
    expect(journey?.journey.registration).toBe("not-required");
    expect(journey?.access.status).toBe("manual");

    await saveJourneySettings(db, up, "hov", {
      registration: { ...testRegistrationConfig, enabled: false },
      access: { mode: "keybox", release: "arrival-day", requiresCompletedRegistration: false },
    });
    const failing: AccessProvider = {
      name: "keybox",
      getCredential: () => Promise.reject(new Error("lock offline")),
    };
    const fallback = await loadStayJourney(
      { db, logger, accessProvider: failing },
      guestContext({ now: ARRIVAL_DAY }),
    );
    expect(fallback?.access.status).toBe("manual");
    expect(
      await loadStayJourney(
        { db, logger, accessProvider: undefined },
        guestContext({ reservation: { status: "unavailable" } }),
      ),
    ).toBeUndefined();
  });
});
