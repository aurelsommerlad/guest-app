import { getLocale, getTranslations } from "next-intl/server";

import { type BookedOfferView } from "../../features/upsell/upsell-service";
import { Link } from "../../i18n/navigation";
import { formatMoney } from "./format";

function formatDates(dates: string[], locale: string): string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return "";
  const day = (value: string) => format.format(new Date(`${value}T00:00:00Z`));
  return first === last ? day(first) : `${day(first)} – ${day(last)}`;
}

/**
 * "Gebucht & angefragt": services on the reservation (from Apaleo via Extras, whatever the
 * source), Extras requests with their real status (angefragt / bestätigt / abgelehnt), the
 * extension night and STAY's own partner requests. Only states the sources provide – Apaleo
 * keeps no removed services, so cancellations are not listed.
 */
export async function V2BookedOverview({ items }: { items: BookedOfferView[] }) {
  const t = await getTranslations("services");
  const locale = await getLocale();
  return (
    <section id="gebucht" aria-labelledby="v2-booked" className="v2-section v2-margin">
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
        <ul className="v2-rows" data-testid="booked-overview">
          {items.map((item) => {
            const meta = [
              formatDates(item.dates, locale),
              item.total && item.total.amountCents > 0
                ? formatMoney(item.total.amountCents, item.total.currency, locale)
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            const content = (
              <>
                <span className="v2-row-label">{t(`booked.status.${item.status}`)}</span>
                <span className="v2-text block">{item.title}</span>
                {meta && <span className="v2-small v2-muted block">{meta}</span>}
              </>
            );
            return (
              <li key={item.id} className="v2-row" data-status={item.status}>
                {item.href ? (
                  <Link href={item.href} style={{ color: "inherit", textDecoration: "none" }}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
