import { EXPLORE_FILTERS, type ExploreFilter } from "@up/core";
import { Container, Heading, Text } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BrandHeader } from "../../../../components/GuestHeader";
import { ExploreBrowser } from "../../../../features/explore/components/ExploreBrowser";
import {
  getExploreCards,
  getExploreIntro,
  getExploreProperty,
} from "../../../../features/explore/get-explore";
import { routing } from "../../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.explore") };
}

/** EXPLORE overview – places personally recommended by UNIQUE PLACES. */
export default async function ExplorePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations("explore");
  const intro = getExploreIntro(locale);
  const cards = getExploreCards(locale);

  const filters = EXPLORE_FILTERS.map((id) => ({ id, label: t(`categories.${id}`) }));
  const countLabels = Object.fromEntries(
    EXPLORE_FILTERS.map((id) => [
      id,
      t("resultsCount", {
        count:
          id === "all" ? cards.length : cards.filter((card) => card.categories.includes(id)).length,
      }),
    ]),
  ) as Record<ExploreFilter, string>;

  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BrandHeader property={getExploreProperty()} />

        <main>
          <div className="mt-6 flex flex-col gap-3 lg:mt-16 lg:max-w-reading">
            <Text variant="eyebrow" tone="muted">
              {t("eyebrow")}
            </Text>
            {intro && (
              <>
                <Heading level={1}>{intro.title}</Heading>
                <Text variant="lead" tone="muted" className="max-w-72 text-balance">
                  {intro.lead}
                </Text>
              </>
            )}
          </div>

          <div className="mt-6 lg:mt-10">
            <ExploreBrowser
              cards={cards}
              filters={filters}
              filterLabel={t("filterLabel")}
              countLabels={countLabels}
              emptyText={t("empty")}
              placesHeading={t("placesHeading")}
            />
          </div>
        </main>
      </Container>
    </div>
  );
}
