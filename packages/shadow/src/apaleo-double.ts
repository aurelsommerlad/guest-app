/**
 * In-memory Apaleo double for shadow tests (M3). It answers the read endpoints the booking
 * engine uses with the data of the Apaleo TEST property (as read on 2026-11-08; same model as
 * guest-services test/support/apaleo-simulator.mjs) and applies simulated gateway commands to
 * its state, so complete flows (book → re-read → verify) can be exercised without any request
 * leaving the process. It is handed to ApaleoClient as `fetch`; every other host throws.
 */
import { type ServiceWriteRequest } from "@up/integrations";

type Money = { grossAmount: number; currency: string };
type BookedDate = { serviceDate: string; count: number; amount: Money; isMandatory: boolean };
type BookedService = {
  service: { id: string; code: string; name: string };
  dates: BookedDate[];
  isMandatory?: boolean;
};

export const TEST_SERVICES: Record<
  string,
  {
    code: string;
    name: { de: string; en: string };
    price: number;
    rule: "arrival" | "departure" | "night" | "none";
    mode: string;
    postNextDay: boolean;
  }
> = {
  "TEST-ECI": { code: "ECI", name: { de: "Früher Check-in", en: "Early Check-in" }, price: 20, rule: "arrival", mode: "Arrival", postNextDay: false },
  "TEST-LCO": { code: "LCO", name: { de: "Später Check-out", en: "Late Check-out" }, price: 20, rule: "departure", mode: "Departure", postNextDay: true },
  "TEST-HUND": { code: "HUND", name: { de: "Hund", en: "Dog fee" }, price: 15, rule: "night", mode: "Daily", postNextDay: false },
  "TEST-PKW": { code: "PKW", name: { de: "Parkplatz", en: "Car park" }, price: 0, rule: "night", mode: "Daily", postNextDay: false },
  "TEST-BABY": { code: "BABY", name: { de: "Babybett", en: "Baby cot" }, price: 15, rule: "night", mode: "Daily", postNextDay: false },
  "TEST-EXTRPERSON": { code: "EXTRPERSON", name: { de: "Zusatzperson", en: "Extra person" }, price: 30, rule: "night", mode: "Daily", postNextDay: false },
  "TEST-FINALCLEAN": { code: "FINALCLEAN", name: { de: "Endreinigung", en: "Final cleaning on departure" }, price: 139, rule: "none", mode: "Departure", postNextDay: false },
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nightsOf(arrival: string, departure: string): string[] {
  const list: string[] = [];
  for (let d = arrival.slice(0, 10); d < departure.slice(0, 10); d = addDays(d, 1)) list.push(d);
  return list;
}

export type DoubleOptions = {
  reservationId?: string;
  arrival?: string;
  departure?: string;
  status?: string;
  adults?: number;
  childrenAges?: number[];
  maxPersons?: number;
  unitId?: string | null;
  physicalCount?: number;
  hasCityTax?: boolean;
  amendDepartureAllowed?: boolean;
};

export type ApaleoState = {
  reservations: Record<string, Record<string, unknown> & { id: string; arrival: string; departure: string; adults: number; comment: string; timeSlices: { serviceDate: string; ratePlan: { id: string }; totalGrossAmount: { amount: number; currency: string } }[]; primaryGuest: { vehicleRegistration?: { number: string; countryCode: string } } }>;
  services: Record<string, BookedService[]>;
  unitGroups: Record<string, { id: string; code: string; maxPersons: number }>;
  soldOut: string[];
  priceOverrides: Record<string, number>;
  /** { serviceId: { date: availableCount } } */
  availability: Record<string, Record<string, number>>;
  physicalCount: number;
  cityTaxPerNight: number | null;
  calls: { method: string; path: string; status: number }[];
};

export class ApaleoDouble {
  state: ApaleoState;
  /** Next matching request answers with this status (failure injection). */
  readonly failures: { method: string; pathIncludes: string; status: number; times: number }[] = [];
  /** Called before every API request (e.g. to change state between display and booking). */
  beforeRequest?: (method: string, path: string) => void;

  constructor(options: DoubleOptions = {}) {
    const id = options.reservationId ?? "JTKQSYFX-1";
    const arrivalDate = options.arrival ?? "2027-01-12";
    const departureDate = options.departure ?? "2027-01-14";
    const ratePlan = { id: "TEST-STD_NO_BF-IGL4", code: "STD_NO_BF" };
    const nights = nightsOf(arrivalDate, departureDate);
    this.state = {
      reservations: {
        [id]: {
          id,
          bookingId: id.split("-")[0],
          status: options.status ?? "Confirmed",
          property: { id: "TEST", code: "TEST", name: "Test run" },
          ...(options.unitId === null
            ? {}
            : { unit: { id: options.unitId ?? "TEST-ZHF", unitGroupId: "TEST-IGL4" } }),
          unitGroup: { id: "TEST-IGL4", code: "IGL4" },
          ratePlan,
          arrival: `${arrivalDate}T16:00:00+01:00`,
          departure: `${departureDate}T10:00:00+01:00`,
          adults: options.adults ?? 2,
          childrenAges: options.childrenAges ?? [9],
          primaryGuest: {},
          comment: "",
          hasCityTax: options.hasCityTax ?? false,
          timeSlices: nights.map((serviceDate) => ({
            serviceDate,
            ratePlan,
            totalGrossAmount: { amount: 99, currency: "EUR" },
          })),
          actions: [{ action: "AmendDeparture", isAllowed: options.amendDepartureAllowed ?? true }],
        },
      },
      services: {
        [id]: [
          {
            service: { id: "TEST-FINALCLEAN", code: "FINALCLEAN", name: "Final cleaning on departure" },
            dates: [
              {
                serviceDate: nights.at(-1) ?? arrivalDate,
                count: 1,
                amount: { grossAmount: 139, currency: "EUR" },
                isMandatory: true,
              },
            ],
            isMandatory: true,
          },
        ],
      },
      unitGroups: {
        "TEST-IGL4": { id: "TEST-IGL4", code: "IGL4", maxPersons: options.maxPersons ?? 6 },
      },
      soldOut: [],
      priceOverrides: {},
      availability: {},
      physicalCount: options.physicalCount ?? 2,
      cityTaxPerNight: options.hasCityTax ? 3.5 : null,
      calls: [],
    };
  }

  reservation(id = Object.keys(this.state.reservations)[0] ?? "") {
    const r = this.state.reservations[id];
    if (!r) throw new Error(`unknown reservation ${id}`);
    return r;
  }

  booked(id = Object.keys(this.state.reservations)[0] ?? "") {
    return this.state.services[id] ?? [];
  }

  /** Writes recorded by method (simulated commands are applied, not called). */
  get writeCalls() {
    return this.state.calls.filter((c) => c.method !== "GET");
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.hostname === "identity.apaleo.com")
      return Promise.resolve(Response.json({ access_token: "double", expires_in: 3600, token_type: "Bearer" }));
    if (url.hostname !== "api.apaleo.com")
      return Promise.reject(new Error(`apaleo double: request to ${url.hostname} refused`));
    this.beforeRequest?.(method, url.pathname);
    const failure = this.failures.find(
      (f) => f.times > 0 && f.method === method && (url.pathname + url.search).includes(f.pathIncludes),
    );
    let response: Response;
    if (failure) {
      failure.times -= 1;
      response = new Response(null, { status: failure.status });
    } else {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      response = this.#handle(method, url, body);
    }
    this.state.calls.push({ method, path: url.pathname + url.search, status: response.status });
    return Promise.resolve(response);
  };

  /** Applies a simulated gateway command the way Apaleo would (ServiceWriteGatewayOptions.onSimulated). */
  readonly applySimulated = (request: ServiceWriteRequest): void => {
    const c = request.command;
    const id = request.reservationId;
    this.state.calls.push({ method: `SIM:${c.operation}`, path: id, status: 200 });
    if (c.operation === "book-service") this.#bookService(id, c.serviceId, c.count, c.dates);
    else if (c.operation === "amend-occupancy" || c.operation === "amend-stay")
      this.#amend(id, c.payload);
    else if (c.operation === "update-vehicle")
      this.reservation(id).primaryGuest.vehicleRegistration = { number: c.number, countryCode: c.countryCode };
    else if (c.operation === "append-comment") {
      const r = this.reservation(id);
      r.comment = r.comment ? `${r.comment}\n${c.text}` : c.text;
    }
  };

  #bookService(
    id: string,
    serviceId: string,
    count: number | undefined,
    dates: readonly { serviceDate: string; count?: number; amount?: { amount: number; currency: string } }[],
  ) {
    const def = TEST_SERVICES[serviceId];
    if (!def) throw new Error(`unknown service ${serviceId}`);
    const list = (this.state.services[id] ??= []);
    const entry: BookedService = {
      service: { id: serviceId, code: def.code, name: def.name.en },
      dates: dates.map((d) => ({
        serviceDate: d.serviceDate,
        count: d.count ?? count ?? 1,
        amount: { grossAmount: d.amount?.amount ?? this.#price(serviceId), currency: d.amount?.currency ?? "EUR" },
        isMandatory: false,
      })),
    };
    const index = list.findIndex((s) => s.service.id === serviceId);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  }

  #amend(id: string, body: Record<string, unknown>) {
    const r = this.reservation(id);
    const oldDeparture = r.departure.slice(0, 10);
    r.arrival = String(body.arrival);
    r.departure = String(body.departure).length === 10 ? `${String(body.departure)}T10:00:00+01:00` : String(body.departure);
    r.adults = Number(body.adults);
    const slices = (body.timeSlices ?? []) as { ratePlanId: string; totalGrossAmount: { amount: number; currency: string } }[];
    const nights = nightsOf(r.arrival, r.departure);
    r.timeSlices = nights.map((serviceDate, i) => ({
      serviceDate,
      ratePlan: { id: slices[i]?.ratePlanId ?? "TEST-STD_NO_BF-IGL4" },
      totalGrossAmount: slices[i]?.totalGrossAmount ?? { amount: 99, currency: "EUR" },
    }));
    if (r.departure.slice(0, 10) !== oldDeparture) {
      for (const s of this.state.services[id] ?? []) {
        if (s.isMandatory) s.dates = s.dates.map((d) => ({ ...d, serviceDate: nights.at(-1) ?? d.serviceDate }));
      }
    }
  }

  #price(serviceId: string) {
    return this.state.priceOverrides[serviceId] ?? TEST_SERVICES[serviceId]?.price ?? 0;
  }

  #offers(r: ApaleoState["reservations"][string]) {
    const nights = nightsOf(r.arrival, r.departure);
    return Object.entries(TEST_SERVICES)
      .filter(([, s]) => s.rule !== "none")
      .map(([id, s]) => {
        const price = this.#price(id);
        const dates = s.rule === "arrival" ? [r.arrival.slice(0, 10)] : s.rule === "departure" ? [r.departure.slice(0, 10)] : nights;
        return {
          service: { id, code: s.code, name: s.name.en },
          count: 1,
          totalAmount: { grossAmount: price * dates.length, currency: "EUR" },
          dates: dates.map((serviceDate) => ({
            serviceDate,
            amount: { grossAmount: price, currency: "EUR" },
            isDefaultDate: true,
            isMandatory: false,
            ...(this.state.availability[id]?.[serviceDate] !== undefined
              ? { availableCount: this.state.availability[id][serviceDate] }
              : {}),
          })),
        };
      });
  }

  #handle(method: string, url: URL, _body: unknown): Response {
    const path = url.pathname;
    let m: RegExpMatchArray | null;
    if ((m = /^\/booking\/v1\/reservations\/([^/]+)$/.exec(path)) && method === "GET") {
      const r = this.state.reservations[decodeURIComponent(m[1] ?? "")];
      return r ? Response.json(r) : new Response(null, { status: 404 });
    }
    if ((m = /^\/booking\/v1\/reservations\/([^/]+)\/services$/.exec(path)) && method === "GET")
      return Response.json({ services: this.state.services[decodeURIComponent(m[1] ?? "")] ?? [] });
    if ((m = /^\/booking\/v1\/reservations\/([^/]+)\/service-offers$/.exec(path)) && method === "GET") {
      const r = this.state.reservations[decodeURIComponent(m[1] ?? "")];
      if (!r) return new Response(null, { status: 404 });
      return Response.json({ services: this.#offers(r) });
    }
    if ((m = /^\/rateplan\/v1\/services\/([^/]+)$/.exec(path)) && method === "GET") {
      const id = decodeURIComponent(m[1] ?? "");
      const def = TEST_SERVICES[id];
      if (!def) return new Response(null, { status: 404 });
      const localized = url.searchParams.get("languages");
      return Response.json({
        id,
        code: def.code,
        name: localized ? def.name : def.name.en,
        description: localized ? def.name : def.name.en,
        postNextDay: def.postNextDay,
        defaultGrossPrice: { amount: def.price, currency: "EUR" },
        availability: { mode: def.mode },
      });
    }
    if ((m = /^\/inventory\/v1\/unit-groups\/([^/]+)$/.exec(path)) && method === "GET") {
      const g = this.state.unitGroups[decodeURIComponent(m[1] ?? "")];
      return g ? Response.json(g) : new Response(null, { status: 404 });
    }
    if (path === "/availability/v1/unit-groups" && method === "GET") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const timeSlices = [];
      for (let d = from; d < to; d = addDays(d, 1)) {
        timeSlices.push({
          from: `${d}T16:00:00+01:00`,
          to: `${addDays(d, 1)}T10:00:00+01:00`,
          unitGroups: [
            {
              unitGroup: { id: "TEST-IGL4" },
              availableCount: this.state.soldOut.includes(d) ? 0 : 1,
              physicalCount: this.state.physicalCount,
            },
          ],
        });
      }
      return Response.json({ timeSlices });
    }
    if (path === "/availability/v1/units" && method === "GET") {
      const day = (url.searchParams.get("from") ?? "").slice(0, 10);
      return Response.json({ units: this.state.soldOut.includes(day) ? [] : [{ id: "TEST-ZHF" }] });
    }
    if (path === "/finance/v1/folios" && method === "GET") {
      const id = url.searchParams.get("reservationIds") ?? "";
      const r = this.state.reservations[id];
      if (!r || this.state.cityTaxPerNight === null) return Response.json({ folios: [] });
      const tax = this.state.cityTaxPerNight;
      return Response.json({
        folios: [
          {
            charges: r.timeSlices.map((s) => ({
              type: "CityTax",
              serviceDate: s.serviceDate,
              amount: { grossAmount: tax, currency: "EUR" },
            })),
          },
        ],
      });
    }
    // The engine never writes over HTTP (gateway is simulated) – any write here is a bug.
    return new Response(null, { status: 501 });
  }
}
