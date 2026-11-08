import { buttonStyles, cx } from "@up/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { EmptyState, PageHeader } from "../../../components/PageHeader";
import { requireAdmin } from "../../auth/server";
import { decideRequestAction, saveExtensionSettingsAction } from "../actions";
import {
  loadAudit,
  loadBooking,
  loadBookings,
  loadExtension,
  loadExtensionSettings,
  loadExtensions,
  loadImport,
  loadImports,
  loadRequest,
  loadRequests,
  type PropertyOption,
} from "../operations-service";
import { operationsDeps } from "../server";
import { ExtensionSettingsForm } from "./ExtensionSettingsForm";

/* ── Formatting ───────────────────────────────────────────────────────────────────────── */

const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});
const dateOnly = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
const fmtDateTime = (d: Date | null | undefined) => (d ? dateTime.format(d) : "–");
const fmtDay = (day: string | null | undefined) =>
  day ? dateOnly.format(new Date(`${day}T00:00:00Z`)) : "–";
const money = (cents: number | null | undefined, currency?: string | null) =>
  cents === null || cents === undefined
    ? "–"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency: currency ?? "EUR" }).format(
        cents / 100,
      );
const nameOf = (properties: readonly PropertyOption[], id: string) =>
  properties.find((p) => p.id === id)?.displayName ?? id;

const REQUEST_STATUS: Record<string, string> = {
  pending: "Offen",
  confirmed: "Bestätigt",
  declined: "Abgelehnt",
  cancelled: "Storniert",
};
const BOOKING_STATUS: Record<string, string> = {
  processing: "In Bearbeitung",
  completed: "Gebucht",
  partial: "Teilweise",
  failed: "Fehlgeschlagen",
};
const EXTENSION_STATUS: Record<string, string> = {
  processing: "In Bearbeitung",
  confirmed: "Bestätigt",
  confirmed_with_issues: "Bestätigt mit Hinweisen",
  failed: "Fehlgeschlagen",
};
const SOURCE = { stay: "STAY", extras: "Extras (importiert)" } as const;

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "type-caption inline-flex items-center rounded-full px-2.5 py-1 whitespace-nowrap",
        tone === "ok" && "bg-status-published text-on-status-published",
        tone === "warn" && "bg-status-draft text-text",
        tone === "muted" && "bg-status-archived text-text-muted",
        tone === "neutral" && "bg-surface text-text",
      )}
    >
      {children}
    </span>
  );
}

function Rows({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-card border border-border bg-surface-raised p-5 sm:grid-cols-[12rem_1fr] md:p-8">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="type-small text-text-muted">{item.label}</dt>
          <dd className="type-body text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
      {children}
    </ul>
  );
}

function Notice({ tone, text }: { tone: "error" | "notice"; text: string }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "type-small rounded-card p-3",
        tone === "error" ? "bg-surface text-text" : "bg-surface-accent text-on-accent",
      )}
    >
      {text}
    </p>
  );
}

const base = (segment: string, viewProperty: string | null) =>
  viewProperty ? `/${segment}/${encodeURIComponent(viewProperty)}` : `/${segment}`;

/* ── Extension nights ─────────────────────────────────────────────────────────────────── */

export async function ExtensionNightsView({ viewProperty }: { viewProperty: string | null }) {
  const admin = await requireAdmin();
  const loaded = await loadExtensionSettings(operationsDeps(), admin, viewProperty);
  if (!loaded.ok) notFound();
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title="Verlängerungsnächte"
        description="„Eine Nacht länger“ je Objekt: Aktivierung, vier Rabattsätze und Mindestbelegung. Bis zum gemeinsamen Go-live gelten weiterhin die Einstellungen in der Extras-App; hier gepflegte Werte sind für STAY vorbereitet."
      />
      {loaded.rows.map(({ property, settings, canEdit }) =>
        viewProperty ? (
          <section
            key={property.id}
            className="rounded-card border border-border bg-surface-raised p-5 md:p-8"
          >
            <ExtensionSettingsForm
              values={settings}
              action={saveExtensionSettingsAction.bind(null, property.id)}
              readOnly={!canEdit}
            />
          </section>
        ) : (
          <Link
            key={property.id}
            href={`/extension-nights/${encodeURIComponent(property.id)}`}
            className="flex flex-col gap-1 rounded-card border border-border bg-surface-raised p-5 hover:bg-surface"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="type-body font-medium text-text">{property.displayName}</span>
              <Badge tone={settings.extensionNightEnabled ? "ok" : "muted"}>
                {settings.extensionNightEnabled ? "aktiv" : "aus"}
              </Badge>
            </span>
            <span className="type-caption text-text-muted">
              Vor Anreise {settings.extensionDiscountPreArrivalOneNightGap} % /{" "}
              {settings.extensionDiscountPreArrivalStandard} % · Im Aufenthalt{" "}
              {settings.extensionDiscountInHouseOneNightGap} % /{" "}
              {settings.extensionDiscountInHouseStandard} % · Mindestbelegung{" "}
              {settings.minSellableStayNights} Nächte
            </span>
          </Link>
        ),
      )}
    </div>
  );
}

/* ── Requests ─────────────────────────────────────────────────────────────────────────── */

const REQUEST_FILTERS = [
  { key: undefined, label: "Alle" },
  { key: "pending", label: "Offen" },
  { key: "confirmed", label: "Bestätigt" },
  { key: "declined", label: "Abgelehnt" },
] as const;

export async function RequestsView({
  viewProperty,
  status,
}: {
  viewProperty: string | null;
  status?: string;
}) {
  const admin = await requireAdmin();
  const filter = REQUEST_FILTERS.find((f) => f.key === status)?.key;
  const loaded = await loadRequests(operationsDeps(), admin, viewProperty, filter);
  if (!loaded.ok) notFound();
  const href = base("requests", viewProperty);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Anfragen"
        description="Anfragen für Services „auf Anfrage“. Aus Extras importierte Anfragen werden bis zum Go-live in der Extras-App entschieden."
      />
      <nav aria-label="Status" className="flex flex-wrap gap-2">
        {REQUEST_FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.key ? `${href}?status=${f.key}` : href}
            aria-current={f.key === filter ? "page" : undefined}
            className={cx(
              "type-small rounded-full border px-3 py-1.5",
              f.key === filter
                ? "border-text bg-surface text-text"
                : "border-border text-text-muted hover:text-text",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {loaded.requests.length === 0 ? (
        <EmptyState
          title="Keine Anfragen"
          description="Hier erscheinen Anfragen der Gäste und aus Extras importierte Anfragen."
        />
      ) : (
        <List>
          {loaded.requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/requests/r/${request.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-body text-text">
                    {request.offerTitle.de ?? request.apaleoServiceId}
                  </span>
                  <span className="type-caption text-text-muted">
                    {nameOf(loaded.properties, request.propertyId)} · Reservierung{" "}
                    {request.externalReservationId} · {fmtDay(request.requestedDate)} ·{" "}
                    {SOURCE[request.source]}
                  </span>
                </span>
                <Badge
                  tone={
                    request.status === "pending"
                      ? "warn"
                      : request.status === "confirmed"
                        ? "ok"
                        : "muted"
                  }
                >
                  {REQUEST_STATUS[request.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

export async function RequestDetailView({
  requestId,
  notice,
  error,
}: {
  requestId: string;
  notice?: string;
  error?: string;
}) {
  const admin = await requireAdmin();
  const loaded = await loadRequest(operationsDeps(), admin, requestId);
  if (!loaded.ok) notFound();
  const { request, canDecide, property } = loaded;
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title={request.offerTitle.de ?? "Anfrage"}
        breadcrumbs={[{ label: "Anfragen", href: "/requests" }]}
        status={
          <Badge
            tone={
              request.status === "pending"
                ? "warn"
                : request.status === "confirmed"
                  ? "ok"
                  : "muted"
            }
          >
            {REQUEST_STATUS[request.status]}
          </Badge>
        }
      />
      {notice && <Notice tone="notice" text={notice} />}
      {error && <Notice tone="error" text={error} />}
      <Rows
        items={[
          { label: "Objekt", value: property?.displayName ?? request.propertyId },
          { label: "Reservierung", value: request.externalReservationId },
          { label: "Apaleo-Service", value: request.apaleoServiceId ?? "–" },
          { label: "Menge", value: request.quantity ?? 1 },
          {
            label: "Gewünschte Daten",
            value:
              (request.requestedDates ?? (request.requestedDate ? [request.requestedDate] : []))
                .map(fmtDay)
                .join(", ") || "–",
          },
          {
            label: "Gebuchte Daten",
            value: request.bookedServiceDates?.map(fmtDay).join(", ") || "–",
          },
          { label: "Angezeigter Preis", value: money(request.quotedCents, request.currency) },
          { label: "Herkunft", value: SOURCE[request.source] },
          { label: "Eingegangen", value: fmtDateTime(request.createdAt) },
          { label: "Entschieden", value: fmtDateTime(request.handledAt) },
        ]}
      />
      {request.source === "extras" && request.status === "pending" && (
        <p className="type-small text-text-muted">
          Diese Anfrage wird bis zum gemeinsamen Go-live in der Extras-App bestätigt oder abgelehnt.
        </p>
      )}
      {canDecide && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-5 md:p-8">
          <p className="type-small text-text-muted">
            Bestätigen bucht den Service über die zentrale Apaleo-Schnittstelle. Solange Buchungen
            aus STAY nicht freigegeben sind, bleibt die Anfrage offen und der Versuch wird
            protokolliert.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={decideRequestAction.bind(null, request.id, "confirm")}>
              <button type="submit" className={buttonStyles("primary")}>
                Bestätigen
              </button>
            </form>
            <form action={decideRequestAction.bind(null, request.id, "decline")}>
              <button type="submit" className={buttonStyles("secondary")}>
                Ablehnen
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Orders ───────────────────────────────────────────────────────────────────────────── */

export async function BookingsView({ viewProperty }: { viewProperty: string | null }) {
  const admin = await requireAdmin();
  const loaded = await loadBookings(operationsDeps(), admin, viewProperty);
  if (!loaded.ok) notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Bestellungen"
        description="Sofort gebuchte Services und Zusatzpersonen – aus STAY und aus Extras importiert. Ohne Gastnamen; die Reservierung führt zu den Details in Apaleo."
      />
      {loaded.bookings.length === 0 ? (
        <EmptyState title="Keine Bestellungen" />
      ) : (
        <List>
          {loaded.bookings.map((booking) => (
            <li key={booking.id}>
              <Link
                href={`/bookings/b/${booking.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-body text-text">
                    Reservierung {booking.externalReservationId} ·{" "}
                    {money(booking.totalCents, booking.currency)}
                  </span>
                  <span className="type-caption text-text-muted">
                    {nameOf(loaded.properties, booking.propertyId)} · {booking.itemCount}{" "}
                    Position(en) · {fmtDateTime(booking.createdAt)} · {SOURCE[booking.source]}
                  </span>
                </span>
                <Badge
                  tone={
                    booking.status === "completed"
                      ? "ok"
                      : booking.status === "failed"
                        ? "muted"
                        : "warn"
                  }
                >
                  {BOOKING_STATUS[booking.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

export async function BookingDetailView({ bookingId }: { bookingId: string }) {
  const admin = await requireAdmin();
  const booking = await loadBooking(operationsDeps(), admin, bookingId);
  if (!booking) notFound();
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title={`Bestellung · ${booking.externalReservationId}`}
        breadcrumbs={[{ label: "Bestellungen", href: "/bookings" }]}
        status={<Badge>{BOOKING_STATUS[booking.status]}</Badge>}
      />
      <Rows
        items={[
          { label: "Objekt", value: booking.propertyId },
          { label: "Reservierung", value: booking.externalReservationId },
          { label: "Buchung", value: booking.externalBookingId ?? "–" },
          { label: "Summe", value: money(booking.totalCents, booking.currency) },
          { label: "Herkunft", value: SOURCE[booking.source] },
          { label: "Zeitpunkt", value: fmtDateTime(booking.createdAt) },
          { label: "Aufbewahrung bis", value: fmtDateTime(booking.purgeAfter) },
        ]}
      />
      <List>
        {booking.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="flex flex-col gap-0.5">
              <span className="type-body text-text">
                {item.displayName} × {item.quantity}
              </span>
              <span className="type-caption text-text-muted">
                {item.apaleoServiceId}
                {item.serviceDates.length ? ` · ${item.serviceDates.map(fmtDay).join(", ")}` : ""}
                {item.errorCode ? ` · Fehler: ${item.errorCode}` : ""}
              </span>
            </span>
            <span className="type-body text-text">{money(item.amountCents, item.currency)}</span>
          </li>
        ))}
      </List>
    </div>
  );
}

/* ── Extensions ───────────────────────────────────────────────────────────────────────── */

export async function ExtensionsView({ viewProperty }: { viewProperty: string | null }) {
  const admin = await requireAdmin();
  const loaded = await loadExtensions(operationsDeps(), admin, viewProperty);
  if (!loaded.ok) notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Verlängerungen"
        description="Gebuchte Verlängerungsnächte mit dem tatsächlichen Ergebnis je Schritt (Nacht, Zusatzleistungen, Late Check-out, Kurtaxe)."
      />
      {loaded.extensions.length === 0 ? (
        <EmptyState title="Keine Verlängerungen" />
      ) : (
        <List>
          {loaded.extensions.map((extension) => (
            <li key={extension.id}>
              <Link
                href={`/extensions/e/${extension.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-body text-text">
                    Reservierung {extension.externalReservationId} ·{" "}
                    {fmtDay(extension.oldDeparture)} → {fmtDay(extension.newDeparture)}
                  </span>
                  <span className="type-caption text-text-muted">
                    {nameOf(loaded.properties, extension.propertyId)} ·{" "}
                    {money(extension.totalAdditionalCents, extension.currency)} ·{" "}
                    {SOURCE[extension.source]}
                  </span>
                </span>
                <Badge tone={extension.status === "confirmed" ? "ok" : "warn"}>
                  {EXTENSION_STATUS[extension.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

type ExtensionDetails = {
  extras?: { serviceId: string; extended: boolean; amountCents: number | null }[];
  lateCheckoutMoves?: { serviceId: string; moved: boolean; verified: boolean }[];
  cityTax?: { applicable: boolean; verified: boolean; amountCents: number | null };
};

export async function ExtensionDetailView({ extensionId }: { extensionId: string }) {
  const admin = await requireAdmin();
  const extension = await loadExtension(operationsDeps(), admin, extensionId);
  if (!extension) notFound();
  const details = extension.details as ExtensionDetails;
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title={`Verlängerung · ${extension.externalReservationId}`}
        breadcrumbs={[{ label: "Verlängerungen", href: "/extensions" }]}
        status={
          <Badge tone={extension.status === "confirmed" ? "ok" : "warn"}>
            {EXTENSION_STATUS[extension.status]}
          </Badge>
        }
      />
      <Rows
        items={[
          { label: "Objekt", value: extension.propertyId },
          {
            label: "Abreise alt → neu",
            value: `${fmtDay(extension.oldDeparture)} → ${fmtDay(extension.newDeparture)}`,
          },
          {
            label: "Neue Abreise bestätigt",
            value: extension.newDepartureConfirmed ? "ja" : "nein",
          },
          {
            label: "Phase",
            value:
              extension.phase === "in_house"
                ? "Während des Aufenthalts"
                : extension.phase === "pre_arrival"
                  ? "Vor der Anreise"
                  : "–",
          },
          { label: "Freie Nächte danach", value: extension.gap ?? "–" },
          {
            label: "Durchschnittspreis/Nacht",
            value: money(extension.averageNightlyRateCents, extension.currency),
          },
          {
            label: "Rabatt",
            value: extension.discountPercent === null ? "–" : `${extension.discountPercent} %`,
          },
          {
            label: "Preis Verlängerungsnacht",
            value: money(extension.extensionPriceCents, extension.currency),
          },
          {
            label: "Gesamt zusätzlich",
            value: money(extension.totalAdditionalCents, extension.currency),
          },
          {
            label: "Zusatzleistungen",
            value: details.extras?.length
              ? details.extras
                  .map(
                    (e) =>
                      `${e.serviceId}: ${e.extended ? "verlängert" : "nicht verlängert"} (${money(e.amountCents)})`,
                  )
                  .join("; ")
              : "–",
          },
          {
            label: "Late Check-out",
            value: details.lateCheckoutMoves?.length
              ? details.lateCheckoutMoves
                  .map(
                    (m) =>
                      `${m.serviceId}: ${m.moved ? "verschoben" : "nicht verschoben"}${m.verified ? ", geprüft" : ""}`,
                  )
                  .join("; ")
              : "–",
          },
          {
            label: "Kurtaxe",
            value: details.cityTax?.applicable
              ? `${money(details.cityTax.amountCents)}${details.cityTax.verified ? " (geprüft)" : " (nicht geprüft)"}`
              : "nicht anwendbar",
          },
          {
            label: "Pflichtleistungen unverändert",
            value:
              extension.mandatoryServicesIntact === null
                ? "–"
                : extension.mandatoryServicesIntact
                  ? "ja"
                  : "nein",
          },
          { label: "Herkunft", value: SOURCE[extension.source] },
          { label: "Zeitpunkt", value: fmtDateTime(extension.createdAt) },
        ]}
      />
    </div>
  );
}

/* ── Audit ────────────────────────────────────────────────────────────────────────────── */

const AUDIT_LABELS: Record<string, string> = {
  "catalog.offer_created": "Service angelegt",
  "catalog.offer_updated": "Service geändert",
  "catalog.offer_status_changed": "Service-Status geändert",
  "catalog.property_config_created": "Service einem Objekt zugeordnet",
  "catalog.property_config_updated": "Objekteinstellung geändert",
  "catalog.property_config_removed": "Service vom Objekt entfernt",
  "settings.extension_updated": "Verlängerungsnächte geändert",
  "request.confirmed": "Anfrage bestätigt",
  "request.declined": "Anfrage abgelehnt",
  "request.confirm_blocked": "Bestätigung nicht ausgeführt (Apaleo-Schreiben gesperrt)",
  "user.invited": "Mitglied eingeladen",
  "user.invitation_accepted": "Einladung angenommen",
  "user.invitation_revoked": "Einladung zurückgezogen",
  "user.access_changed": "Rolle/Objekte geändert",
  "user.disabled": "Konto deaktiviert",
  "user.enabled": "Konto aktiviert",
  "migration.applied": "Extras-Import übernommen",
  "writer.state_changed": "Go-live-Zustand geändert",
};

export async function AuditView() {
  const admin = await requireAdmin();
  const loaded = await loadAudit(operationsDeps(), admin);
  if (!loaded.ok) notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Protokoll"
        description="Unveränderliches Protokoll aller Änderungen im Admin – mit Feldnamen, ohne Inhalte oder personenbezogene Daten."
      />
      {loaded.events.length === 0 ? (
        <EmptyState title="Noch keine Einträge" />
      ) : (
        <List>
          {loaded.events.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 p-4">
              <span className="type-body text-text">
                {AUDIT_LABELS[event.action] ?? event.action}
              </span>
              <span className="type-caption text-text-muted">
                {fmtDateTime(event.createdAt)} ·{" "}
                {event.actorType === "admin"
                  ? "Admin"
                  : event.actorType === "import"
                    ? "Import"
                    : event.actorType}
                {event.propertyId ? ` · ${event.propertyId}` : ""}
                {Array.isArray((event.details as { changedFields?: unknown }).changedFields)
                  ? ` · Felder: ${(event.details as { changedFields: string[] }).changedFields.join(", ")}`
                  : ""}
              </span>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

/* ── Imports ──────────────────────────────────────────────────────────────────────────── */

const RUN_STATUS: Record<string, string> = {
  running: "läuft",
  completed: "abgeschlossen",
  failed: "fehlgeschlagen",
};

export async function ImportsView() {
  const admin = await requireAdmin();
  const loaded = await loadImports(operationsDeps(), admin);
  if (!loaded.ok) notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Datenimport aus Extras"
        description="Probeläufe und Übernahmen des Extras-Imports mit Ergebnis je Datensatz. Ausgeführt wird der Import mit dem Werkzeug extras:import (Probelauf zuerst) – nie gegen die Produktionsdatenbank."
      />
      {loaded.runs.length === 0 ? (
        <EmptyState
          title="Noch kein Import"
          description="Nach der Freigabe von M0 wird zuerst ein Probelauf ausgeführt."
        />
      ) : (
        <List>
          {loaded.runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/imports/${run.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="type-body text-text">
                    {run.mode === "apply" ? "Übernahme" : "Probelauf"} ·{" "}
                    {fmtDateTime(run.startedAt)}
                  </span>
                  <span className="type-caption text-text-muted">
                    Snapshot {run.snapshotSha256.slice(0, 12)}…
                  </span>
                </span>
                <Badge tone={run.status === "completed" ? "ok" : "warn"}>
                  {RUN_STATUS[run.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  create: "neu",
  update: "aktualisiert",
  unchanged: "unverändert",
  conflict: "Konflikt",
  skip: "übersprungen",
  error: "Fehler",
};

export async function ImportDetailView({ runId }: { runId: string }) {
  const admin = await requireAdmin();
  const loaded = await loadImport(operationsDeps(), admin, runId);
  if (!loaded) notFound();
  const { run, items } = loaded;
  const summary = run.summary as Record<string, Record<string, number>>;
  const attention = items.filter(
    (item) =>
      item.action === "conflict" || item.action === "error" || (item.reason ?? "").startsWith("w_"),
  );
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${run.mode === "apply" ? "Übernahme" : "Probelauf"} · ${fmtDateTime(run.startedAt)}`}
        breadcrumbs={[{ label: "Datenimport", href: "/imports" }]}
        status={
          <Badge tone={run.status === "completed" ? "ok" : "warn"}>{RUN_STATUS[run.status]}</Badge>
        }
        description={`Snapshot-Prüfsumme ${run.snapshotSha256}`}
      />
      <div className="overflow-x-auto rounded-card border border-border bg-surface-raised">
        <table className="type-small w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">Bereich</th>
              {Object.values(ACTION_LABELS).map((label) => (
                <th key={label} className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(summary)
              .filter(([, value]) => typeof value === "object")
              .map(([entity, actions]) => (
                <tr key={entity} className="border-b border-border last:border-0">
                  <td className="p-3">{entity}</td>
                  {Object.keys(ACTION_LABELS).map((action) => (
                    <td key={action} className="p-3">
                      {actions[action] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="type-title text-text">
          Konflikte, Fehler und Hinweise ({attention.length})
        </h2>
        {attention.length === 0 ? (
          <p className="type-small text-text-muted">Keine.</p>
        ) : (
          <List>
            {attention.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-3 p-4">
                <span className="type-small text-text">
                  {item.entityType} · {item.sourceKey}
                </span>
                <span className="type-caption text-text-muted">
                  {ACTION_LABELS[item.action]}
                  {item.reason ? ` · ${item.reason}` : ""}
                </span>
              </li>
            ))}
          </List>
        )}
      </section>
    </div>
  );
}
