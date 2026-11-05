import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { getStay } from "../../../../features/stay/get-stay";
import { routing } from "../../../../i18n/routing";
import { V2Facts } from "../../../../v2/components/V2Facts";
import { V2Header } from "../../../../v2/components/V2Header";
import { V2Photo } from "../../../../v2/components/V2Photo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.stay") };
}

/** V2 home ("Gästemappe"): greeting, the stay at a glance, three photographs. */
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
                href={extras.href}
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
      </main>
    </div>
  );
}
