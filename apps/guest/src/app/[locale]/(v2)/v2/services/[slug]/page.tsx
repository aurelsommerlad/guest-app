import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { upsellEnabled } from "../../../../../../config/upsell";
import { serverEnv } from "../../../../../../env/server";
import { requireGuestContext } from "../../../../../../features/guest-context/server";
import { getOfferCatalog } from "../../../../../../features/upsell/server";
import { Link } from "../../../../../../i18n/navigation";
import { routing } from "../../../../../../i18n/routing";
import { V2Arrow } from "../../../../../../v2/components/glyphs";
import { V2Header } from "../../../../../../v2/components/V2Header";
import { formatCancellation, formatDuration } from "../../../../../../v2/upsell/format";
import { OfferViewBeacon } from "../../../../../../v2/upsell/OfferTracking";
import { V2OfferAction } from "../../../../../../v2/upsell/V2OfferAction";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.services") };
}

/** One offer: photograph, story, the facts in hairline rows, "Gut zu wissen", one action. */
export default async function V2OfferPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  await connection();
  const context = await requireGuestContext(locale);
  if (!upsellEnabled(context.property)) notFound();
  const catalog = await getOfferCatalog(context, locale);
  const offer = catalog?.offers.find((item) => item.slug === decodeURIComponent(slug));
  if (!offer) notFound();
  const t = await getTranslations("services");
  const by = [offer.partnerName, offer.locality].filter(Boolean).join(", ");

  return (
    <div className="v2-page">
      <V2Header />
      <OfferViewBeacon offerId={offer.id} />
      <main>
        <section className="v2-intro v2-margin">
          <p className="v2-eyebrow">
            {t(`chapters.${offer.chapter}`)} · {t(`categories.${offer.category}`)}
          </p>
          <h1 className="v2-display">{offer.title}</h1>
          {offer.teaser && <p className="v2-lead">{offer.teaser}</p>}
        </section>

        {offer.image && (
          <div className="v2-inset">
            <div className="v2-offer-hero">
              <Image
                src={offer.image.src}
                alt={offer.image.alt}
                fill
                sizes="(min-width: 600px) 560px, 100vw"
                preload
                style={{ objectFit: "cover" }}
              />
            </div>
          </div>
        )}

        <section aria-labelledby="v2-offer-facts" className="v2-section v2-margin">
          <h2 id="v2-offer-facts" className="v2-sr-only">
            {t("facts.heading")}
          </h2>
          <dl className="v2-rows">
            {by && (
              <div className="v2-row">
                <dt>{t("facts.partner")}</dt>
                <dd className="v2-text">{by}</dd>
              </div>
            )}
            {offer.durationMinutes !== undefined && (
              <div className="v2-row">
                <dt>{t("facts.duration")}</dt>
                <dd className="v2-text">{formatDuration(offer.durationMinutes, t)}</dd>
              </div>
            )}
            <div className="v2-row">
              <dt>{t("facts.booking")}</dt>
              <dd className="v2-text">{t(`fulfillment.${offer.fulfillment}`)}</dd>
            </div>
            <div className="v2-row">
              <dt>{t("facts.cancellation")}</dt>
              <dd className="v2-text">{formatCancellation(offer.cancellation, t)}</dd>
            </div>
          </dl>
        </section>

        {offer.body.length > 0 && (
          <section aria-labelledby="v2-offer-about" className="v2-section v2-margin">
            <div className="v2-section-head">
              <h2 id="v2-offer-about" className="v2-eyebrow">
                {t("about")}
              </h2>
            </div>
            <div className="v2-offer-paragraphs" style={{ paddingTop: 18 }}>
              {offer.body.map((paragraph, index) => (
                <p key={index} className="v2-body">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        )}

        {offer.details.length > 0 && (
          <section aria-labelledby="v2-offer-details" className="v2-section v2-margin">
            <div className="v2-section-head">
              <h2 id="v2-offer-details" className="v2-eyebrow">
                {t("goodToKnow")}
              </h2>
            </div>
            <ul className="v2-rows">
              {offer.details.map((line, index) => (
                <li key={index} className="v2-row v2-small">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="v2-margin" aria-label={t("facts.price")}>
          <V2OfferAction offer={offer} extrasUrl={serverEnv.EXTRAS_APP_URL} />
          {offer.pricePreview && (
            <p className="v2-caption v2-muted" style={{ marginTop: 14 }}>
              {t("previewNote")}
            </p>
          )}
        </section>

        <div className="v2-margin" style={{ marginTop: 32 }}>
          <Link href="/v2/services" className="v2-link v2-text">
            <span>{t("actions.back")}</span>
            <V2Arrow />
          </Link>
        </div>
      </main>
    </div>
  );
}
