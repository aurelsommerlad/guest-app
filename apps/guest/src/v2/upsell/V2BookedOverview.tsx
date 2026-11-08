import { getTranslations } from "next-intl/server";

import { type BookedOfferView } from "../../features/upsell/upsell-service";

/**
 * "Gebucht & angefragt" (prepared in Phase 1): requests of this reservation from STAY. Phase 2
 * adds the services booked through Extras (from Apaleo, read-only) and partner confirmations.
 */
export async function V2BookedOverview({ items }: { items: BookedOfferView[] }) {
  const t = await getTranslations("services");
  return (
    <section aria-labelledby="v2-booked" className="v2-section v2-margin">
      <div className="v2-section-head">
        <h2 id="v2-booked" className="v2-eyebrow">
          {t("booked.heading")}
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="v2-body v2-muted" style={{ paddingTop: 18 }}>
          {t("booked.empty")}
        </p>
      ) : (
        <dl className="v2-rows">
          {items.map((item) => (
            <div key={item.id} className="v2-row">
              <dt>{t(`booked.status.${item.status}`)}</dt>
              <dd className="v2-text">{item.title}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
