import { getLocale, getTranslations } from "next-intl/server";

import { type OfferView } from "../../features/upsell/offer-view";
import { V2Arrow } from "../components/glyphs";
import { formatOfferPrice } from "./format";
import { OfferClickOut } from "./OfferTracking";

/**
 * The offer's single action (Phase 1, nothing is booked or requested through STAY):
 * - own services → the existing Extras app, which alone books into Apaleo;
 * - partner requests → shown, but not yet sendable (Phase 2: request via UNIQUE PLACES);
 * - partner links → the partner's own page, counted as click-out.
 */
export async function V2OfferAction({
  offer,
  extrasUrl,
}: {
  offer: OfferView;
  extrasUrl: string | undefined;
}) {
  const t = await getTranslations("services");
  const locale = await getLocale();
  const price = formatOfferPrice(offer.price, t, locale);
  return (
    <div className="v2-offer-action">
      <div className="v2-offer-action-price">
        <span className="v2-offer-action-amount">{price}</span>
        {offer.pricePreview && <span className="v2-preview-mark">{t("price.preview")}</span>}
      </div>
      {offer.kind === "house-service" &&
        (extrasUrl ? (
          <>
            <a
              href={extrasUrl}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="v2-button"
            >
              <span>{t("actions.extras")}</span>
              <V2Arrow />
              <span className="v2-sr-only"> {t("actions.opensExternal")}</span>
            </a>
            <p className="v2-small v2-muted">{t("actions.extrasNote")}</p>
          </>
        ) : (
          <p className="v2-small v2-muted">{t("actions.extrasUnavailable")}</p>
        ))}
      {offer.kind === "partner" && offer.fulfillment === "request" && (
        <>
          <button type="button" disabled className="v2-button">
            <span>{t("actions.request")}</span>
            <V2Arrow />
          </button>
          <p className="v2-small v2-muted">{t("actions.requestNote")}</p>
        </>
      )}
      {offer.kind === "partner" && offer.fulfillment === "link" && offer.bookingUrl && (
        <>
          <OfferClickOut offerId={offer.id} href={offer.bookingUrl} className="v2-button">
            <span>{t("actions.link")}</span>
            <V2Arrow />
            <span className="v2-sr-only"> {t("actions.opensExternal")}</span>
          </OfferClickOut>
          <p className="v2-small v2-muted">{t("actions.linkNote")}</p>
        </>
      )}
    </div>
  );
}
