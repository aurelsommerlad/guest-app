import { Callout, Container, DetailList, type DetailListItem, Heading, Text } from "@up/ui";
import type { Metadata } from "next";
import Image from "next/image";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BackHeader } from "../../../../../components/GuestHeader";
import { PlaceActions } from "../../../../../features/explore/components/PlaceActions";
import { getPlaceDetail } from "../../../../../features/explore/get-explore";
import { requireGuestContext } from "../../../../../features/guest-context/server";
import { routing } from "../../../../../i18n/routing";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function loadPlace(params: Props["params"]) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Places depend on the guest's property, so pages render per request;
  // unknown slugs (or a slug of another locale) are 404s.
  const context = await requireGuestContext(locale);
  const place = getPlaceDetail(context, locale, slug);
  if (!place) notFound();
  return place;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const place = await loadPlace(params);
  return { title: place.title };
}

/** A personal recommendation – editorial, not a directory entry. */
export default async function PlacePage({ params }: Props) {
  const place = await loadPlace(params);
  const t = await getTranslations("explore");

  const details: DetailListItem[] = [
    ...(place.openingHours
      ? [
          {
            id: "hours",
            icon: "clock" as const,
            label: t("openingHours"),
            value: place.openingHours,
          },
        ]
      : []),
    ...(place.address
      ? [
          {
            id: "address",
            icon: "map-pin" as const,
            label: t("address"),
            value: place.address.join("\n"),
          },
        ]
      : []),
  ];

  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BackHeader href="/explore" label={t("backLabel")} />

        <main className="lg:max-w-reading">
          <article>
            <header className="mt-6 flex flex-col gap-3 lg:mt-16">
              <Text variant="eyebrow" tone="muted">
                {t(`categories.${place.category}`)}
              </Text>
              <Heading level={1}>{place.title}</Heading>
            </header>

            <Image
              src={place.image.src}
              width={place.image.width}
              height={place.image.height}
              alt={place.image.alt}
              sizes="(min-width: 768px) 640px, 100vw"
              preload
              placeholder={place.image.blurDataUrl ? "blur" : "empty"}
              blurDataURL={place.image.blurDataUrl}
              className="mt-6 aspect-hero w-full rounded-card object-cover lg:mt-8"
            />

            {place.recommendation && (
              <Text variant="lead" className="mt-8 text-balance">
                {place.recommendation}
              </Text>
            )}
            {place.description.map((paragraph, index) => (
              <Text key={index} className="mt-4">
                {paragraph}
              </Text>
            ))}

            {place.goodToKnow && (
              <Callout title={t("goodToKnow")} className="mt-8">
                {place.goodToKnow}
              </Callout>
            )}

            {(details.length > 0 || place.actions.length > 0) && (
              <section
                aria-labelledby="place-details-heading"
                className="mt-8 border-t border-border pt-8"
              >
                <h2 id="place-details-heading" className="sr-only">
                  {t("detailsHeading")}
                </h2>
                {details.length > 0 && <DetailList items={details} />}
                <div className={details.length > 0 ? "mt-8" : undefined}>
                  <PlaceActions actions={place.actions} />
                </div>
              </section>
            )}
          </article>
        </main>
      </Container>
    </div>
  );
}
