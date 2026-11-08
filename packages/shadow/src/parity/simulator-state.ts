/**
 * The guest-services Apaleo simulator keeps its state in a JSON file (APALEO_SIM_STATE). The
 * parity harness resets it per scenario, adjusts it, and applies STAY's simulated gateway
 * commands to it with the simulator's own write semantics – so STAY and Extras read the same
 * simulated Apaleo and are compared on the resulting state. Nothing here performs HTTP.
 */
import fs from "node:fs";

import { type ServiceWriteRequest } from "@up/integrations";

import { TEST_SERVICES } from "../apaleo-double";

export type SimState = {
  reservations: Record<string, SimReservation>;
  services: Record<string, SimService[]>;
  unitGroups: Record<string, { id: string; maxPersons: number }>;
  soldOut: string[];
  priceOverrides?: Record<string, number>;
  availability?: Record<string, Record<string, number>>;
  calls: { method: string; path: string; status?: number }[];
};
export type SimReservation = {
  id: string;
  status: string;
  arrival: string;
  departure: string;
  adults: number;
  childrenAges: number[];
  comment: string;
  ratePlan: { id: string };
  unit?: { id: string; unitGroupId: string };
  unitGroup: { id: string };
  primaryGuest: { vehicleRegistration?: { number: string; countryCode: string } };
  timeSlices: {
    serviceDate: string;
    ratePlan: { id: string };
    totalGrossAmount: { amount: number; currency: string };
  }[];
  actions: { action: string; isAllowed: boolean }[];
  hasCityTax: boolean;
};
export type SimService = {
  service: { id: string; code: string; name: string };
  dates: {
    serviceDate: string;
    count: number;
    amount: { grossAmount: number; currency: string };
    isMandatory: boolean;
  }[];
  isMandatory?: boolean;
};

export const statePath = () => {
  const path = process.env.APALEO_SIM_STATE;
  if (!path) throw new Error("APALEO_SIM_STATE is not set");
  return path;
};

export const readState = (): SimState =>
  JSON.parse(fs.readFileSync(statePath(), "utf8")) as SimState;
export const writeState = (state: SimState) => {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
};

function addDays(date: string, days: number) {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function nights(arrival: string, departure: string) {
  const list: string[] = [];
  for (let d = arrival.slice(0, 10); d < departure.slice(0, 10); d = addDays(d, 1)) list.push(d);
  return list;
}

/** Applies a simulated STAY command exactly like the simulator applies the Extras HTTP write. */
export function applyToSimulator(request: ServiceWriteRequest): void {
  const state = readState();
  const id = request.reservationId;
  const reservation = state.reservations[id];
  if (!reservation) throw new Error(`simulator: unknown reservation ${id}`);
  const c = request.command;
  state.calls.push({ method: `SIM:${c.operation}`, path: id });
  if (c.operation === "book-service") {
    const def = TEST_SERVICES[c.serviceId];
    if (!def) throw new Error(`simulator: unknown service ${c.serviceId}`);
    const list = (state.services[id] ??= []);
    const entry: SimService = {
      service: { id: c.serviceId, code: def.code, name: def.name.en },
      dates: c.dates.map((d) => ({
        serviceDate: d.serviceDate,
        count: d.count ?? c.count ?? 1,
        amount: {
          grossAmount: d.amount?.amount ?? def.price,
          currency: d.amount?.currency ?? "EUR",
        },
        isMandatory: false,
      })),
    };
    const index = list.findIndex((s) => s.service.id === c.serviceId);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  } else if (c.operation === "amend-occupancy" || c.operation === "amend-stay") {
    const body = c.payload;
    const oldDeparture = reservation.departure.slice(0, 10);
    reservation.arrival = String(body.arrival);
    reservation.departure =
      String(body.departure).length === 10
        ? `${String(body.departure)}${reservation.departure.slice(10)}`
        : String(body.departure);
    reservation.adults = body.adults;
    const list = nights(reservation.arrival, reservation.departure);
    reservation.timeSlices = list.map((serviceDate, i) => ({
      serviceDate,
      ratePlan: {
        ...reservation.ratePlan,
        id: body.timeSlices[i]?.ratePlanId ?? reservation.ratePlan.id,
      },
      totalGrossAmount: body.timeSlices[i]?.totalGrossAmount ?? { amount: 99, currency: "EUR" },
    }));
    if (reservation.departure.slice(0, 10) !== oldDeparture) {
      for (const s of state.services[id] ?? []) {
        if (s.isMandatory)
          s.dates = s.dates.map((d) => ({ ...d, serviceDate: list.at(-1) ?? d.serviceDate }));
      }
    }
  } else if (c.operation === "update-vehicle") {
    reservation.primaryGuest.vehicleRegistration = { number: c.number, countryCode: c.countryCode };
  } else if (c.operation === "append-comment") {
    reservation.comment = reservation.comment ? `${reservation.comment}\n${c.text}` : c.text;
  }
  writeState(state);
}
