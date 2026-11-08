import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";

import { type OfferView } from "../../features/upsell/offer-view";
import { Link } from "../../i18n/navigation";
import { V2Arrow } from "../components/glyphs";
import { formatOfferPrice } from "./format";

/**
 * Editorial offer surfaces: one large photograph with the text below it, the rest as numbered
 * hairline rows. Square corners, no cards, no badges – a magazine, not a shop.
 */
export async function V2OfferFeature({
  offer,
  priority = false,
}: {
  offer: OfferView;
  priority?: boolean;
}) {
  const t = await getTranslations("services");
  const locale = await getLocale();
  const by = [offer.partnerName, offer.locality].filter(Boolean).join(" · ");
  return (
    <Link href={offer.href} className="v2-offer-feature" data-offer-id={offer.id}>
      {offer.image ? (
        <span className="v2-offer-media block">
          <Image
            src={offer.image.src}
            alt={offer.image.alt}
            fill
            sizes="(min-width: 600px) 560px, 100vw"
            preload={priority}
            style={{ objectFit: "cover" }}
          />
        </span>
      ) : (
        <span className="v2-offer-media v2-offer-media--empty" aria-hidden>
          <span>{t(`categories.${offer.category}`)}</span>
        </span>
      )}
      <span className="v2-offer-text">
        <span className="v2-eyebrow v2-muted block">{t(`categories.${offer.category}`)}</span>
        <span className="v2-offer-title block">{offer.title}</span>
        {offer.teaser && <span className="v2-body v2-muted block">{offer.teaser}</span>}
        <span className="v2-offer-meta">
          <span>
            {formatOfferPrice(offer.price, t, locale)}
            {offer.pricePreview && <span className="v2-sr-only"> ({t("price.preview")})</span>}
          </span>
          <span className="v2-muted">{by}</span>
          <V2Arrow />
        </span>
      </span>
    </Link>
  );
}

export async function V2OfferRows({ offers, start = 1 }: { offers: OfferView[]; start?: number }) {
  if (offers.length === 0) return null;
  const t = await getTranslations("services");
  const locale = await getLocale();
  return (
    <ol className="v2-offer-rows" start={start}>
      {offers.map((offer, index) => (
        <li key={offer.id} className="v2-offer-row" data-offer-id={offer.id}>
          <Link href={offer.href}>
            <span className="v2-offer-row-number" aria-hidden>
              {String(start + index).padStart(2, "0")}
            </span>
            <span className="v2-offer-row-title">{offer.title}</span>
            <span className="v2-offer-row-price">{formatOfferPrice(offer.price, t, locale)}</span>
            <span className="v2-eyebrow">
              {[t(`categories.${offer.category}`), offer.partnerName]
                .filter((part) => part && part.toLowerCase() !== offer.title.toLowerCase())
                .join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** One large offer, the rest as rows – used by chapters and the home module. */
export function V2OfferList({
  offers,
  priority = false,
}: {
  offers: OfferView[];
  priority?: boolean;
}) {
  const [first, ...rest] = offers;
  if (!first) return null;
  return (
    <>
      <div className="v2-inset">
        <V2OfferFeature offer={first} priority={priority} />
      </div>
      {rest.length > 0 && (
        <div className="v2-margin" style={{ marginTop: 18 }}>
          <V2OfferRows offers={rest} start={2} />
        </div>
      )}
    </>
  );
}
