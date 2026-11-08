import { PmsError } from "@up/core";
import { describe, expect, it, vi } from "vitest";

import {
  parseServiceWriteMode,
  type ServiceWriteExecutor,
  ServiceWriteGateway,
  type ServiceWriteRequest,
  serviceWriteRequestHash,
  type ServiceWriteStore,
} from "./write-gateway";

type Row = { id: string; key: string; hash: string; status: string; code: string | null };

function memoryStore(writer: "extras" | "stay" = "extras") {
  const rows = new Map<string, Row>();
  const store: ServiceWriteStore = {
    getServiceWriter: () => Promise.resolve(writer),
    reserve: (input) => {
      const existing = rows.get(input.idempotencyKey);
      if (!existing) {
        const row = {
          id: `op-${rows.size + 1}`,
          key: input.idempotencyKey,
          hash: input.requestHash,
          status: "pending",
          code: null,
        };
        rows.set(input.idempotencyKey, row);
        return Promise.resolve({ kind: "acquired", id: row.id, takeover: false });
      }
      if (existing.hash !== input.requestHash)
        return Promise.resolve({ kind: "conflict", id: existing.id });
      if (existing.status === "pending")
        return Promise.resolve({ kind: "in-progress", id: existing.id });
      return Promise.resolve({
        kind: "done",
        id: existing.id,
        status: existing.status as "blocked",
        resultCode: existing.code,
      });
    },
    complete: (input) => {
      for (const row of rows.values())
        if (row.id === input.id)
          Object.assign(row, { status: input.status, code: input.resultCode });
      return Promise.resolve();
    },
  };
  return { store, rows };
}

const request = (overrides: Partial<ServiceWriteRequest> = {}): ServiceWriteRequest => ({
  tenantId: "unique-places",
  propertyId: "test-run",
  apaleoPropertyId: "TEST",
  reservationId: "JTKQSYFX-1",
  idempotencyKey: "order:abc:TEST-LCO",
  trigger: "guest",
  command: {
    operation: "book-service",
    serviceId: "TEST-LCO",
    dates: [{ serviceDate: "2026-11-10", count: 1 }],
  },
  ...overrides,
});

const confirmed = () => Promise.resolve({ property: { id: "TEST" }, status: "Confirmed" });

describe("service write gateway (M1: never writes to Apaleo)", () => {
  it("is disabled unless explicitly simulated – 'live' is not a mode", () => {
    expect(parseServiceWriteMode(undefined)).toBe("disabled");
    expect(parseServiceWriteMode("live")).toBe("disabled");
    expect(parseServiceWriteMode("enabled")).toBe("disabled");
    expect(parseServiceWriteMode("simulated")).toBe("simulated");
  });

  it("records every command as blocked while writes are disabled, without touching Apaleo", async () => {
    const { store, rows } = memoryStore();
    const lookup = vi.fn(confirmed);
    const executor = vi.fn<ServiceWriteExecutor>();
    const gateway = new ServiceWriteGateway({
      mode: "disabled",
      allowedApaleoPropertyIds: ["TEST"],
      store,
      lookupReservation: lookup,
      executor,
    });
    expect(await gateway.execute(request())).toEqual({
      status: "blocked",
      code: "writes_disabled",
      replayed: false,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    expect([...rows.values()][0]).toMatchObject({ status: "blocked", code: "writes_disabled" });
  });

  it("refuses a real executor while Extras is the production writer", async () => {
    const { store } = memoryStore("extras");
    const executor = vi.fn<ServiceWriteExecutor>(() => Promise.resolve({ code: "booked" }));
    const gateway = new ServiceWriteGateway({
      mode: "simulated",
      allowedApaleoPropertyIds: ["TEST"],
      store,
      lookupReservation: confirmed,
      executor,
    });
    expect(await gateway.execute(request())).toMatchObject({
      status: "blocked",
      code: "writer_is_extras",
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("checks property allowlist, reservation property and status before any write", async () => {
    const make = (lookup: () => Promise<{ property: { id: string }; status: string }>) =>
      new ServiceWriteGateway({
        mode: "simulated",
        allowedApaleoPropertyIds: ["TEST"],
        store: memoryStore().store,
        lookupReservation: lookup,
      });
    expect(await make(confirmed).execute(request({ apaleoPropertyId: "ALTUS" }))).toMatchObject({
      code: "property_not_allowed",
    });
    expect(
      await make(() => Promise.resolve({ property: { id: "ALTUS" }, status: "Confirmed" })).execute(
        request(),
      ),
    ).toMatchObject({
      code: "reservation_property_mismatch",
    });
    expect(
      await make(() => Promise.resolve({ property: { id: "TEST" }, status: "CheckedOut" })).execute(
        request(),
      ),
    ).toMatchObject({
      code: "reservation_not_bookable",
    });
    expect(
      await make(() =>
        Promise.reject(new PmsError("not-found", "x", { provider: "apaleo", status: 404 })),
      ).execute(request()),
    ).toMatchObject({ status: "blocked", code: "reservation_not_found" });
  });

  it("simulates a valid command once; a retry returns the stored result", async () => {
    const { store } = memoryStore();
    const gateway = new ServiceWriteGateway({
      mode: "simulated",
      allowedApaleoPropertyIds: ["TEST"],
      store,
      lookupReservation: confirmed,
    });
    expect(await gateway.execute(request())).toEqual({
      status: "simulated",
      code: "simulated",
      replayed: false,
    });
    expect(await gateway.execute(request())).toEqual({
      status: "simulated",
      code: "simulated",
      replayed: true,
    });
  });

  it("rejects a reused idempotency key with a different payload", async () => {
    const { store } = memoryStore();
    const gateway = new ServiceWriteGateway({
      mode: "simulated",
      allowedApaleoPropertyIds: ["TEST"],
      store,
      lookupReservation: confirmed,
    });
    await gateway.execute(request());
    expect(
      await gateway.execute(
        request({
          command: {
            operation: "book-service",
            serviceId: "TEST-LCO",
            dates: [{ serviceDate: "2026-11-11", count: 1 }],
          },
        }),
      ),
    ).toEqual({ status: "rejected", code: "idempotency_conflict" });
  });

  it("hashes requests independent of key order", () => {
    const a = request();
    const b = {
      ...request(),
      command: {
        dates: a.command.operation === "book-service" ? a.command.dates : [],
        serviceId: "TEST-LCO",
        operation: "book-service" as const,
      },
    };
    expect(serviceWriteRequestHash(a)).toBe(serviceWriteRequestHash(b));
  });

  it("refuses malformed idempotency keys", async () => {
    const gateway = new ServiceWriteGateway({
      mode: "disabled",
      allowedApaleoPropertyIds: [],
      store: memoryStore().store,
      lookupReservation: confirmed,
    });
    await expect(gateway.execute(request({ idempotencyKey: "a b" }))).rejects.toThrow(TypeError);
  });
});
