import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { upsellEnabled } from "../../../../../config/upsell";
import { requireGuestContext } from "../../../../../features/guest-context/server";
import { getOfferCatalog } from "../../../../../features/upsell/server";
import { routing } from "../../../../../i18n/routing";
import { V2Header } from "../../../../../v2/components/V2Header";
import { OfferImpressions } from "../../../../../v2/upsell/OfferTracking";
import { V2BookedOverview } from "../../../../../v2/upsell/V2BookedOverview";
import { V2OfferList } from "../../../../../v2/upsell/V2Offers";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.services") };
}

/**
 * "Services & Erlebnisse": two chapters – own services ("Für Deinen Aufenthalt") and local
 * partners ("Die Region erleben") – each one photograph and a few rows, then the guest's
 * bookings and requests. Test properties with design V2 only (upselling Phase 1).
 */
export default async function V2ServicesPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await requireGuestContext(locale);
  if (!upsellEnabled(context.property)) notFound();
  const catalog = await getOfferCatalog(context, locale);
  const t = await getTranslations("services");
  const stay = catalog?.offers.filter((offer) => offer.chapter === "stay") ?? [];
  const region = catalog?.offers.filter((offer) => offer.chapter === "region") ?? [];
  const chapters = [
    { id: "stay", offers: stay },
    { id: "region", offers: region },
  ] as const;
  const preview = stay.some((offer) => offer.pricePreview);

  return (
    <div className="v2-page">
      <V2Header />
      <main>
        <section className="v2-intro v2-margin">
          <p className="v2-eyebrow">{t("eyebrow")}</p>
          <h1 className="v2-display">{t("title")}</h1>
          <p className="v2-lead">{t("lead")}</p>
        </section>

        {!catalog && <p className="v2-body v2-margin v2-muted">{t("empty")}</p>}

        {catalog && (
          <OfferImpressions placement="services">
            {chapters.map((chapter, index) => (
              <section
                key={chapter.id}
                id={chapter.id === "stay" ? "aufenthalt" : "region"}
                aria-labelledby={`v2-chapter-${chapter.id}`}
                className="v2-chapter"
              >
                <div className="v2-margin">
                  <div className="v2-chapter-head">
                    <span className="v2-chapter-number" aria-hidden>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2 id={`v2-chapter-${chapter.id}`} className="v2-chapter-title">
                      {t(`chapters.${chapter.id}`)}
                    </h2>
                    <p className="v2-chapter-intro v2-small v2-muted">
                      {t(`chapters.${chapter.id}Intro`)}
                    </p>
                  </div>
                </div>
                {chapter.id === "stay" && catalog.house === "unavailable" ? (
                  <p className="v2-notice v2-margin" style={{ marginTop: 18 }}>
                    {t("houseUnavailable")}
                  </p>
                ) : chapter.offers.length > 0 ? (
                  <V2OfferList offers={chapter.offers} priority={index === 0} />
                ) : (
                  <p className="v2-body v2-margin v2-muted" style={{ paddingTop: 18 }}>
                    {t("noOffers")}
                  </p>
                )}
              </section>
            ))}
          </OfferImpressions>
        )}

        {catalog && <V2BookedOverview items={catalog.booked} />}

        {preview && (
          <p className="v2-caption v2-margin v2-muted" style={{ marginTop: 32 }}>
            {t("previewNote")}
          </p>
        )}
      </main>
    </div>
  );
}
