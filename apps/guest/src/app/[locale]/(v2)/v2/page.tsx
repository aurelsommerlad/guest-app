import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { upsellEnabled } from "../../../../config/upsell";
import { requireGuestContext } from "../../../../features/guest-context/server";
import { getStay } from "../../../../features/stay/get-stay";
import { getOfferCatalog } from "../../../../features/upsell/server";
import { homeRecommendations } from "../../../../features/upsell/upsell-service";
import { Link } from "../../../../i18n/navigation";
import { routing } from "../../../../i18n/routing";
import { V2Arrow } from "../../../../v2/components/glyphs";
import { V2Facts } from "../../../../v2/components/V2Facts";
import { V2Header } from "../../../../v2/components/V2Header";
import { V2Photo } from "../../../../v2/components/V2Photo";
import { OfferImpressions } from "../../../../v2/upsell/OfferTracking";
import { V2OfferList } from "../../../../v2/upsell/V2Offers";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.stay") };
}

/**
 * V2 home ("Gästemappe"): greeting, the stay at a glance, three photographs and – where
 * "Services & Erlebnisse" is switched on – a short personal selection for the stay's phase.
 */
export default async function V2HomePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const stay = await getStay(locale);
  const t = await getTranslations("stay");
  const v2 = await getTranslations("v2");
  const br = () => <br />;
  const line = (chunks: React.ReactNode) => <span className="block">{chunks}</span>;
  const firstName = stay.guest.firstName;
  const greeting = stay.upcoming
    ? firstName
      ? t.rich("greetingUpcoming", { firstName, line })
      : t.rich("greetingUpcomingWithoutName", { line })
    : firstName
      ? t.rich("greeting", { firstName, br })
      : t.rich("greetingWithoutName", { br });

  const card = (id: "guide" | "extras" | "explore") => stay.cards.find((item) => item.id === id);
  const guide = card("guide");
  const extras = card("extras");
  const explore = card("explore");
  const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
  const context = await requireGuestContext(locale);
  const upsell = upsellEnabled(context.property);
  const catalog = upsell ? await getOfferCatalog(context, locale) : undefined;
  const picks = catalog ? homeRecommendations(catalog) : [];
  const s = await getTranslations("services");

  return (
    <div className="v2-page">
      <V2Header />
      <main>
        <section className="v2-intro v2-margin">
          <p className="v2-eyebrow">{v2("eyebrow")}</p>
          <h1 className="v2-display">{greeting}</h1>
          <p className="v2-lead">{t("subline")}</p>
        </section>

        <V2Facts stay={stay} />

        <section aria-labelledby="v2-photos-heading" className="v2-inset">
          <h2 id="v2-photos-heading" className="v2-sr-only">
            {t("cardsHeading")}
          </h2>
          <div className="v2-photos">
            {guide && (
              <V2Photo
                variant="feature"
                href={guide.href}
                eyebrow={v2("cards.guide")}
                title={sentence(guide.title)}
                image={guide.image}
                priority
              />
            )}
            {extras && (
              <V2Photo
                variant="half"
                href={upsell ? "/v2/services" : extras.href}
                eyebrow={v2("cards.extras")}
                title={v2("cards.extrasTitle")}
                image={extras.image}
              />
            )}
            {explore && (
              <V2Photo
                variant="half"
                href={explore.href}
                eyebrow={v2("cards.explore")}
                title={sentence(explore.title)}
                image={explore.image}
              />
            )}
          </div>
        </section>

        {picks.length > 0 && (
          <section aria-labelledby="v2-picks" className="v2-section">
            <div className="v2-margin">
              <div className="v2-section-head">
                <h2 id="v2-picks" className="v2-eyebrow">
                  {s("home.heading")}
                </h2>
              </div>
            </div>
            <OfferImpressions placement="home">
              <V2OfferList offers={picks} />
            </OfferImpressions>
            <div className="v2-margin">
              <Link href="/v2/services" className="v2-link v2-text">
                <span>{s("home.all")}</span>
                <V2Arrow />
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
