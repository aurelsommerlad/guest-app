/**
 * Field-by-field comparison of an Extras run and a STAY run of one scenario. Every difference
 * becomes a deviation; nothing is corrected or hidden here – explanations are attached later
 * (report.ts) and an unexplained deviation stays "ungeklärt".
 */
type Obj = Record<string, unknown>;

export type RunResult = {
  steps: { kind: string; value: unknown }[];
  state: {
    departure: string | null;
    adults: number | null;
    timeSlices: string[];
    vehicle: string | null;
    comment: string[];
    services: { id: string; dates: string[] }[];
    writes: string[];
  };
};

export type Deviation = {
  scenario: string;
  step: string;
  field: string;
  extras: unknown;
  stay: unknown;
};

const CATALOG_FIELDS = [
  "actionType",
  "bookingRule",
  "fulfillmentMode",
  "unitPrice",
  "nights",
  "price",
  "serviceDates",
  "unitGroupRestricted",
  "maxQuantity",
  "maxOnePerReservation",
  "alreadyBooked",
  "requiresVehicleRegistration",
  "existingVehicleRegistration",
] as const;
const TEXT_FIELDS = ["displayName", "description", "priceUnitLabel"] as const;
const OFFER_FIELDS = [
  "currentDeparture",
  "newDeparture",
  "averageNightlyRate",
  "extensionPrice",
  "discountPercent",
  "gap",
  "phase",
  "cityTax",
  "totalPrice",
] as const;

const norm = (value: unknown): string =>
  JSON.stringify(value ?? null, (_k, v: unknown) =>
    typeof v === "number" ? Math.round(v * 100) / 100 : v,
  );
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});

export function compareScenario(scenario: string, extras: RunResult, stay: RunResult): Deviation[] {
  const out: Deviation[] = [];
  const diff = (step: string, field: string, a: unknown, b: unknown) => {
    if (norm(a) !== norm(b))
      out.push({ scenario, step, field, extras: a ?? null, stay: b ?? null });
  };
  extras.steps.forEach((e, index) => {
    const s = stay.steps[index];
    const step = `${String(index + 1)}:${e.kind}`;
    if (!s) {
      diff(step, "step", e.kind, null);
      return;
    }
    const ev = obj(e.value);
    const sv = obj(s.value);
    if (e.kind === "catalog") {
      diff(step, "pastStay", ev.pastStay, sv.pastStay);
      const ei = (ev.items as Obj[] | undefined) ?? [];
      const si = (sv.items as Obj[] | undefined) ?? [];
      diff(
        step,
        "Reihenfolge/angezeigte Services",
        ei.map((i) => i.serviceId),
        si.map((i) => i.serviceId),
      );
      for (const item of ei) {
        const other = si.find((i) => i.serviceId === item.serviceId);
        if (!other) continue;
        for (const f of CATALOG_FIELDS)
          diff(step, `${String(item.serviceId)}.${f}`, item[f], other[f]);
        for (const f of TEXT_FIELDS)
          diff(step, `${String(item.serviceId)}.${f}`, item[f], other[f]);
      }
    } else if (e.kind === "extension-offer") {
      diff(step, "Angebot vorhanden", e.value !== null, s.value !== null);
      if (e.value && s.value) {
        for (const f of OFFER_FIELDS) diff(step, f, ev[f], sv[f]);
        const ex = ((ev.extras as Obj[] | undefined) ?? []).map(
          (x) => `${String(x.serviceId)}@${norm(obj(x.amount).amount)}`,
        );
        const sx = ((sv.extras as Obj[] | undefined) ?? []).map(
          (x) => `${String(x.serviceId)}@${norm(obj(x.amount).amount)}`,
        );
        diff(step, "extras", ex, sx);
        diff(
          step,
          "extras.name",
          ((ev.extras as Obj[] | undefined) ?? []).map((x) => x.name),
          ((sv.extras as Obj[] | undefined) ?? []).map((x) => x.name),
        );
      }
    } else {
      for (const key of new Set([...Object.keys(ev), ...Object.keys(sv)]))
        diff(step, key, ev[key], sv[key]);
    }
  });
  const a = extras.state;
  const b = stay.state;
  diff("Apaleo-Endzustand", "Abreise", a.departure, b.departure);
  diff("Apaleo-Endzustand", "Erwachsene", a.adults, b.adults);
  diff("Apaleo-Endzustand", "Zeitscheiben (Preis je Nacht)", a.timeSlices, b.timeSlices);
  diff("Apaleo-Endzustand", "Kennzeichen", a.vehicle, b.vehicle);
  diff("Apaleo-Endzustand", "Services auf der Reservierung", a.services, b.services);
  diff("Apaleo-Endzustand", "Reservierungskommentar", a.comment, b.comment);
  diff("Apaleo-Endzustand", "Schreibvorgänge", a.writes, b.writes);
  return out;
}
