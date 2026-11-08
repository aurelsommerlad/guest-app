import { buttonStyles, cx } from "@up/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Field, Input } from "../../../components/fields";
import { EmptyState, PageHeader, SectionHeader } from "../../../components/PageHeader";
import { isAllowed } from "../../auth/authorization";
import { requireAdmin } from "../../auth/server";
import { getTenantProperties } from "../../property-context/server";
import { BOOKING_RULE_LABELS } from "../../services/labels";
import { shadowDeps } from "../server";
import { loadShadow } from "../shadow-service";

const euro = (amount: number | undefined | null, currency = "EUR") =>
  amount === null || amount === undefined
    ? "–"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
const day = (value: string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );

const HIDDEN: Record<string, string> = {
  inactive: "nicht im Gäste-Portal angezeigt",
  unpublished: "Angebot nicht veröffentlicht",
  no_capacity: "keine freie Personenkapazität",
  invalid_extra_person_price: "Konfigurationsfehler: Aufpreis pro Person fehlt",
  no_offer: "von Apaleo für diese Reservierung nicht angeboten",
  incomplete_dates: "nicht an allen erforderlichen Tagen verfügbar",
};

function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={cx(
        "type-caption inline-flex rounded-full px-2.5 py-1 whitespace-nowrap",
        tone === "warn" ? "bg-status-draft text-text" : "bg-surface text-text",
      )}
    >
      {children}
    </span>
  );
}

export async function ShadowView({
  propertyId,
  reservationId,
}: {
  propertyId: string | null;
  reservationId?: string;
}) {
  const admin = await requireAdmin();
  const properties = (await getTenantProperties()).filter((p) =>
    isAllowed(admin, "catalog.read", { propertyId: p.id }),
  );
  if (!properties.length) redirect("/forbidden");
  const header = (
    <PageHeader
      title="Schattenbetrieb"
      description="STAY berechnet hier nur lesend, was ein Gast dieser Reservierung sehen würde: Services, Preise, Daten, Mengen, Einschränkungen und die Verlängerungsnacht. Es wird nichts gebucht. Bis zum Go-live bucht weiterhin die Extras-App."
    />
  );
  if (!propertyId) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <EmptyState title="Objekt wählen" description="Bitte oben ein Objekt auswählen." />
      </div>
    );
  }
  const result = reservationId
    ? await loadShadow(shadowDeps(), admin, propertyId, reservationId)
    : undefined;
  return (
    <div className="flex flex-col gap-8">
      {header}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-80">
          <Field label="Reservierungsnummer" htmlFor="reservation">
            <Input
              id="reservation"
              name="reservation"
              defaultValue={reservationId ?? ""}
              placeholder="z. B. ABCDEFGH-1"
              required
            />
          </Field>
        </div>
        <button type="submit" className={buttonStyles("primary")}>
          Berechnen
        </button>
      </form>
      {result && !result.ok && (
        <p role="alert" className="type-small rounded-card bg-surface p-3 text-text">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <>
          <p className="type-small rounded-card bg-surface-accent p-3 text-on-accent" role="status">
            Reservierung {result.reservation.id}: {day(result.reservation.arrival)} –{" "}
            {day(result.reservation.departure)} · {result.reservation.adults} Erwachsene,{" "}
            {result.reservation.children === 1
              ? "1 Kind"
              : `${String(result.reservation.children)} Kinder`}{" "}
            · Apartmenttyp {result.reservation.unitGroupId ?? "–"} · Status{" "}
            {result.reservation.status}
            {result.source === "fixture"
              ? " · Testdaten (lokal, kein Apaleo-Zugriff)"
              : " · live aus Apaleo gelesen"}
          </p>
          <section className="flex flex-col gap-4">
            <SectionHeader id="services" title="Services für den Gast" />
            {result.catalog.pastStay ? (
              <EmptyState
                title="Aufenthalt vorbei"
                description="Für vergangene Aufenthalte werden keine Services angeboten."
              />
            ) : result.catalog.items.length === 0 ? (
              <EmptyState
                title="Keine Services"
                description="Für diese Reservierung ist kein Service buchbar."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
                {result.catalog.items.map((item) => (
                  <li
                    key={item.serviceId}
                    className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between"
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="type-body text-text">{item.displayName.de}</span>
                      <span className="type-caption text-text-muted">
                        {item.serviceId} ·{" "}
                        {item.bookingRule in BOOKING_RULE_LABELS
                          ? BOOKING_RULE_LABELS[
                              item.bookingRule as keyof typeof BOOKING_RULE_LABELS
                            ]
                          : "pro Person und Nacht"}{" "}
                        ·{" "}
                        {item.serviceDates?.length
                          ? item.serviceDates.map(day).join(", ")
                          : `${String(item.nights)} Nächte`}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <Tag>
                          {item.fulfillmentMode === "request" ? "Auf Anfrage" : "Sofort buchbar"}
                        </Tag>
                        {item.maxQuantity !== null && <Tag>max. {item.maxQuantity}</Tag>}
                        {item.alreadyBooked && <Tag tone="warn">bereits gebucht</Tag>}
                        {item.unitGroupRestricted && (
                          <Tag tone="warn">Apartmenttyp nicht erlaubt</Tag>
                        )}
                        {item.requiresVehicleRegistration && <Tag>Kennzeichen nötig</Tag>}
                      </span>
                    </span>
                    <span className="type-body shrink-0 text-text tabular-nums md:text-right">
                      {euro(item.price?.amount, item.price?.currency)}
                      <span className="type-caption block text-text-muted">
                        {euro(item.unitPrice?.amount, item.unitPrice?.currency)}{" "}
                        {item.priceUnitLabel.de}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {result.catalog.hidden.length > 0 && (
            <section className="flex flex-col gap-4">
              <SectionHeader
                id="hidden"
                title="Nicht angezeigt"
                description="Konfigurierte Services, die dieser Gast nicht sieht – mit Grund."
              />
              <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
                {result.catalog.hidden.map((h) => (
                  <li
                    key={`${h.serviceId}-${h.reason}`}
                    className="flex flex-wrap justify-between gap-2 p-4"
                  >
                    <span className="type-body text-text">{h.serviceId}</span>
                    <span className="type-small text-text-muted">
                      {HIDDEN[h.reason] ?? h.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="flex flex-col gap-4">
            <SectionHeader id="extension" title="Verlängerungsnacht" />
            {result.extension ? (
              <dl className="grid gap-x-6 gap-y-3 rounded-card border border-border bg-surface-raised p-5 sm:grid-cols-2 md:p-8">
                {[
                  ["Neue Abreise", day(result.extension.newDeparture)],
                  [
                    "Phase",
                    result.extension.phase === "in_house" ? "im Aufenthalt" : "vor Anreise",
                  ],
                  ["Freie Folgenächte", String(result.extension.gap)],
                  ["Durchschnitt pro Nacht", euro(result.extension.averageNightlyRate.amount)],
                  ["Rabatt", `${String(result.extension.discountPercent)} %`],
                  ["Preis der Nacht", euro(result.extension.extensionPrice.amount)],
                  [
                    "Verlängerte Leistungen",
                    result.extension.extras
                      .map((e) => `${e.name.de} ${euro(e.amount.amount)}`)
                      .join(", ") || "–",
                  ],
                  [
                    "Kurtaxe",
                    result.extension.cityTax ? euro(result.extension.cityTax.amount) : "–",
                  ],
                  ["Gesamt", euro(result.extension.totalPrice.amount)],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="type-small text-text-muted">{label}</dt>
                    <dd className="type-body text-text">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState
                title="Kein Angebot"
                description="Die Verlängerung ist ausgeschaltet, die Folgenacht nicht sicher frei oder Apaleo erlaubt keine Änderung der Abreise."
              />
            )}
          </section>
          <p className="type-caption text-text-muted">
            Abgleich mit der Extras-App: siehe Paritätsbericht{" "}
            <Link
              className="underline"
              href="https://github.com/aurelsommerlad/guest-app/blob/claude/sharp-rubin-hwfdyt/docs/staging/extras-migration-m3-paritaet.md"
            >
              extras-migration-m3-paritaet.md
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
