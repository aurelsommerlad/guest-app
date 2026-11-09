import { getLocale, getTranslations } from "next-intl/server";

import { type OfferView } from "../../features/upsell/offer-view";
import { Link } from "../../i18n/navigation";
import { V2Arrow } from "../components/glyphs";
import { formatMoney, formatOfferPrice } from "./format";
import { type CartRow, V2ServiceCart } from "./V2ServiceCart";

function day(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The extension night first, as in Extras – but in STAY's voice: the new departure, the struck
 * original night, the discount and the price, one action. Only rendered when the source (Extras
 * bridge or STAY engine) actually offers the night for this reservation.
 */
export async function V2ExtensionHighlight({ offer }: { offer: OfferView }) {
  const booking = offer.booking;
  if (booking?.kind !== "extension" || booking.state !== "open") return null;
  const t = await getTranslations("services.extension");
  const locale = await getLocale();
  const night = booking.accommodationCents;
  return (
    <section
      className="v2-extension v2-margin"
      aria-labelledby="v2-extension-title"
      data-testid="extension-highlight"
    >
      <p className="v2-eyebrow">{t("eyebrow")}</p>
      <h3 id="v2-extension-title" className="v2-extension-title">
        {t("title", { date: day(booking.newDeparture, locale) })}
      </h3>
      <p className="v2-body v2-muted">{t("lead")}</p>
      <dl className="v2-extension-prices">
        {night !== null && (
          <div>
            <dt>{t("night")}</dt>
            <dd>
              {booking.originalCents !== null && booking.originalCents > night && (
                <s className="v2-muted">
                  <span className="v2-sr-only">
                    {t("original", {
                      amount: formatMoney(booking.originalCents, booking.currency, locale),
                    })}
                  </span>
                  <span aria-hidden>
                    {formatMoney(booking.originalCents, booking.currency, locale)}
                  </span>
                </s>
              )}
              <span>{formatMoney(night, booking.currency, locale)}</span>
            </dd>
          </div>
        )}
        {booking.discountPercent !== null && booking.discountPercent > 0 && (
          <div>
            <dt className="v2-sr-only">%</dt>
            <dd className="v2-extension-discount">
              {t("discount", { percent: booking.discountPercent })}
            </dd>
          </div>
        )}
        <div>
          <dt>{t("total")}</dt>
          <dd className="v2-extension-total" data-testid="extension-total">
            {formatMoney(booking.totalCents, booking.currency, locale)}
          </dd>
        </div>
      </dl>
      <Link href={offer.href} className="v2-button" data-testid="extension-cta">
        <span>{t("cta")}</span>
        <V2Arrow />
      </Link>
    </section>
  );
}

/**
 * Own services as Extras lists them – picture, text, price with its unit, the fitting action and
 * any restriction right at the service – with a shared selection to book several at once. The
 * rows are prepared here (texts, prices); the selection lives in the client list.
 */
export async function V2HouseServiceRows({ offers }: { offers: OfferView[] }) {
  if (offers.length === 0) return null;
  const t = await getTranslations("services");
  const locale = await getLocale();
  const rows: CartRow[] = offers.map((offer) => {
    const booking = offer.booking?.kind === "service" ? offer.booking : undefined;
    const state = booking?.state ?? "open";
    const selectable =
      booking &&
      state === "open" &&
      booking.fulfillment === "instant" &&
      booking.unitCents !== null &&
      booking.maxQuantity !== 0
        ? {
            serviceId: booking.serviceId,
            unitCents: booking.unitCents,
            nights: booking.nights,
            currency: booking.currency,
            maxQuantity: booking.maxQuantity,
            quantity: booking.quantity,
            requiresPlate: booking.requiresPlate,
            existingPlate: booking.existingPlate,
          }
        : null;
    return {
      id: offer.id,
      href: offer.href,
      title: offer.title,
      teaser: offer.teaser && offer.teaser.trim() !== offer.title.trim() ? offer.teaser : null,
      image: offer.image ? { src: offer.image.src } : null,
      priceText: formatOfferPrice(offer.price, t, locale),
      state,
      request: booking?.fulfillment === "request",
      selectable,
    };
  });
  return <V2ServiceCart rows={rows} />;
}
