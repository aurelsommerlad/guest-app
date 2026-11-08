import { SERVICE_CONFIG_ISSUE_LABELS, type ServiceConfigIssue } from "@up/core";
import { buttonStyles, cx } from "@up/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, PageHeader } from "../../../components/PageHeader";
import { StatusBadge } from "../../../components/StatusBadge";
import { requireAdmin } from "../../auth/server";
import { mediaStorageConfig } from "../../guide/server";
import {
  changeOfferStatusAction,
  createOfferAction,
  removeConfigAction,
  saveConfigAction,
  updateOfferAction,
} from "../actions";
import { emptyConfig, loadApaleoOptions, loadCatalog, loadOffer } from "../catalog-service";
import { catalogDeps } from "../server";
import { BOOKING_RULE_LABELS, CATEGORY_LABELS } from "../labels";
import { PropertyConfigEditor } from "./PropertyConfigEditor";
import { OfferEditor } from "./OfferEditor";

const de = (text: { de?: string } | null | undefined) => text?.de ?? "";
const offerHref = (offerId: string) => `/services/offers/${encodeURIComponent(offerId)}`;

function IssueNote({ issues }: { issues: readonly ServiceConfigIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="type-caption flex flex-col gap-0.5 text-text">
      {issues.map((issue) => (
        <li key={issue}>⚠ {SERVICE_CONFIG_ISSUE_LABELS[issue]}</li>
      ))}
    </ul>
  );
}

function Pill({ tone, children }: { tone: "ok" | "muted" | "warn"; children: string }) {
  return (
    <span
      className={cx(
        "type-caption inline-flex items-center rounded-full px-2.5 py-1 whitespace-nowrap",
        tone === "ok" && "bg-status-published text-on-status-published",
        tone === "muted" && "bg-status-archived text-text-muted",
        tone === "warn" && "bg-status-draft text-text",
      )}
    >
      {children}
    </span>
  );
}

/** Catalog list – all services with their properties, or one property's configuration. */
export async function CatalogListView({ viewProperty }: { viewProperty: string | null }) {
  const admin = await requireAdmin();
  const loaded = await loadCatalog(catalogDeps(), admin);
  if (!loaded.ok) notFound();
  const { properties, canEditOffers } = loaded;
  if (viewProperty && !properties.some((p) => p.id === viewProperty)) notFound();
  const offers = viewProperty
    ? loaded.offers.filter((offer) => offer.properties.some((c) => c.propertyId === viewProperty))
    : loaded.offers;
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.displayName ?? id;
  const sorted = viewProperty
    ? [...offers].sort(
        (a, b) =>
          (a.properties.find((c) => c.propertyId === viewProperty)?.sortOrder ?? 0) -
          (b.properties.find((c) => c.propertyId === viewProperty)?.sortOrder ?? 0),
      )
    : offers;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Servicekatalog"
        description={
          viewProperty
            ? `Services, die Gäste in ${nameOf(viewProperty)} buchen oder anfragen können – in der Reihenfolge der Gästeansicht.`
            : "Ein zentraler Katalog: Texte und Bilder einmal, Apaleo-Service, Preise, Regeln und Sichtbarkeit je Objekt."
        }
        actions={
          canEditOffers ? (
            <Link href="/services/offers/new" className={buttonStyles("primary")}>
              Neuer Service
            </Link>
          ) : undefined
        }
      />
      {sorted.length === 0 ? (
        <EmptyState
          title="Noch keine Services"
          description="Services entstehen hier oder beim Import aus der Extras-App (als Entwurf)."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
          {sorted.map((offer) => {
            const configs = viewProperty
              ? offer.properties.filter((c) => c.propertyId === viewProperty)
              : offer.properties;
            return (
              <li
                key={offer.id}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={offerHref(offer.id)}
                    className="type-body font-medium text-text underline-offset-4 hover:underline"
                  >
                    {de(offer.title)}
                  </Link>
                  <span className="type-caption text-text-muted">
                    {(CATEGORY_LABELS as Record<string, string | undefined>)[offer.category] ??
                      offer.category}
                    {offer.legacyKey ? " · aus Extras importiert" : ""}
                  </span>
                  {configs.map((config) => (
                    <div key={config.propertyId} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`${offerHref(offer.id)}/${encodeURIComponent(config.propertyId)}`}
                          className="type-small text-text underline-offset-4 hover:underline"
                        >
                          {nameOf(config.propertyId)}
                        </Link>
                        <Pill tone={config.active ? "ok" : "muted"}>
                          {config.active ? "sichtbar" : "ausgeblendet"}
                        </Pill>
                        <span className="type-caption text-text-muted">
                          {config.extrasServiceId ?? "kein Apaleo-Service"} ·{" "}
                          {config.actionType === "increase_occupancy"
                            ? "Zusatzperson"
                            : BOOKING_RULE_LABELS[config.bookingRule ?? "per_stay"]}{" "}
                          · {config.fulfillment === "request" ? "auf Anfrage" : "sofort"}
                          {viewProperty ? ` · Reihenfolge ${config.sortOrder}` : ""}
                        </span>
                      </div>
                      <IssueNote issues={offer.issues[config.propertyId] ?? []} />
                    </div>
                  ))}
                  {configs.length === 0 && (
                    <span className="type-caption text-text-muted">
                      Noch keinem Objekt zugeordnet.
                    </span>
                  )}
                </div>
                <StatusBadge status={offer.status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export async function NewOfferView() {
  const admin = await requireAdmin();
  const loaded = await loadCatalog(catalogDeps(), admin);
  if (!loaded.ok || !loaded.canEditOffers) notFound();
  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title="Neuer Service"
        breadcrumbs={[{ label: "Servicekatalog", href: "/services" }]}
        description="Neue Services sind zunächst Entwurf. Danach je Objekt den Apaleo-Service, die Regeln und die Sichtbarkeit festlegen."
      />
      <OfferEditor
        action={createOfferAction}
        readOnly={false}
        uploadEnabled={mediaStorageConfig() !== undefined}
        submitLabel="Service anlegen"
      />
    </div>
  );
}

export async function OfferView({ offerId, error }: { offerId: string; error?: string }) {
  const admin = await requireAdmin();
  const loaded = await loadOffer(catalogDeps(), admin, offerId);
  if (!loaded.ok) notFound();
  const { offer, properties, canEditOffer, editableProperties } = loaded;
  const assigned = new Set(offer.properties.map((c) => c.propertyId));
  const addable = properties.filter(
    (p) => !assigned.has(p.id) && editableProperties.includes(p.id),
  );
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.displayName ?? id;
  const statusActions = canEditOffer
    ? (["published", "draft", "archived"] as const).filter((status) => status !== offer.status)
    : [];
  const statusLabel = {
    published: "Veröffentlichen",
    draft: "Zurück auf Entwurf",
    archived: "Archivieren (deaktivieren)",
  };

  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title={de(offer.title)}
        breadcrumbs={[{ label: "Servicekatalog", href: "/services" }]}
        status={<StatusBadge status={offer.status} />}
        description={
          offer.legacyKey ? `Aus der Extras-App importiert (${offer.legacyKey}).` : undefined
        }
        actions={
          statusActions.length ? (
            <>
              {statusActions.map((status) => (
                <form key={status} action={changeOfferStatusAction.bind(null, offer.id, status)}>
                  <button
                    type="submit"
                    className={buttonStyles(status === "published" ? "primary" : "secondary")}
                  >
                    {statusLabel[status]}
                  </button>
                </form>
              ))}
            </>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="type-small rounded-card bg-surface p-3 text-text">
          {error}
        </p>
      )}
      <section
        aria-labelledby="offer-properties"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised p-5 md:p-8"
      >
        <h2 id="offer-properties" className="type-title text-text">
          Objekte
        </h2>
        {offer.properties.length === 0 && (
          <p className="type-small text-text-muted">Noch keinem Objekt zugeordnet.</p>
        )}
        <ul className="flex flex-col gap-3">
          {offer.properties.map((config) => (
            <li
              key={config.propertyId}
              className="flex flex-wrap items-start justify-between gap-3"
            >
              <div className="flex flex-col gap-1">
                <Link
                  href={`${offerHref(offer.id)}/${encodeURIComponent(config.propertyId)}`}
                  className="type-body text-text underline underline-offset-4"
                >
                  {nameOf(config.propertyId)}
                </Link>
                <span className="type-caption text-text-muted">
                  {config.active ? "sichtbar" : "ausgeblendet"} ·{" "}
                  {config.extrasServiceId ?? "kein Apaleo-Service"}
                  {config.importedAt ? " · importiert" : ""}
                </span>
                <IssueNote issues={offer.issues[config.propertyId] ?? []} />
              </div>
              {editableProperties.includes(config.propertyId) && (
                <form action={removeConfigAction.bind(null, offer.id, config.propertyId)}>
                  <button type="submit" className="type-small text-text-muted underline">
                    Vom Objekt entfernen
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <span className="type-small text-text-muted">Zuordnen:</span>
            {addable.map((property) => (
              <Link
                key={property.id}
                href={`${offerHref(offer.id)}/${encodeURIComponent(property.id)}`}
                className="type-small rounded-control border border-border px-3 py-1.5 text-text hover:bg-surface"
              >
                + {property.displayName}
              </Link>
            ))}
          </div>
        )}
      </section>
      <OfferEditor
        values={{
          title: offer.title,
          teaser: offer.teaser,
          body: offer.body,
          details: offer.details,
          category: offer.category,
          fulfillment: offer.fulfillment,
          cancellation: offer.cancellation,
          heroImage: offer.heroImage,
        }}
        action={updateOfferAction.bind(null, offer.id)}
        readOnly={!canEditOffer}
        uploadEnabled={mediaStorageConfig() !== undefined}
        submitLabel="Speichern"
      />
    </div>
  );
}

export async function PropertyConfigView({
  offerId,
  propertyId,
}: {
  offerId: string;
  propertyId: string;
}) {
  const admin = await requireAdmin();
  const deps = catalogDeps();
  const loaded = await loadOffer(deps, admin, offerId);
  if (!loaded.ok) notFound();
  const property = loaded.properties.find((p) => p.id === propertyId);
  if (!property) notFound();
  const existing = loaded.offer.properties.find((c) => c.propertyId === propertyId);
  const editable = loaded.editableProperties.includes(propertyId);
  if (!existing && !editable) notFound();
  const apaleo = await loadApaleoOptions(deps, admin, propertyId);
  const values = existing ?? {
    ...emptyConfig(),
    fulfillment: loaded.offer.fulfillment === "request" ? "request" : "instant",
  };

  return (
    <div className="flex max-w-224 flex-col gap-8">
      <PageHeader
        title={`${de(loaded.offer.title)} · ${property.displayName}`}
        breadcrumbs={[
          { label: "Servicekatalog", href: `/services/${encodeURIComponent(propertyId)}` },
          { label: de(loaded.offer.title), href: offerHref(offerId) },
        ]}
        description={
          existing
            ? existing.importedAt
              ? "Aus Extras importiert. Änderungen hier werden bei einem erneuten Import nicht überschrieben (Konflikt im Bericht)."
              : undefined
            : "Neue Zuordnung zu diesem Objekt."
        }
      />
      <IssueNote issues={existing ? (loaded.offer.issues[propertyId] ?? []) : []} />
      <PropertyConfigEditor
        values={values}
        apaleo={apaleo}
        action={saveConfigAction.bind(null, offerId, propertyId)}
        readOnly={!editable}
        submitLabel={existing ? "Speichern" : "Zuordnen und speichern"}
      />
    </div>
  );
}
