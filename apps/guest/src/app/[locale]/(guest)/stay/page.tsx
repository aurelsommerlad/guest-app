import { Container } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BrandHeader } from "../../../../components/GuestHeader";
import { AccessPanel } from "../../../../features/stay/components/AccessPanel";
import { Greeting } from "../../../../features/stay/components/Greeting";
import { StayCards } from "../../../../features/stay/components/StayCards";
import { StayTiles } from "../../../../features/stay/components/StayTiles";
import { getStay } from "../../../../features/stay/get-stay";
import { routing } from "../../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.stay") };
}

/** STAY home – the guest's personal start screen. */
export default async function StayPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const stay = await getStay(locale);
  const accessFirst = stay.journeyPhase === "arrival-day";
  const accessPanel = stay.access && (
    <div className="mt-2 lg:mt-8 lg:max-w-reading">
      <AccessPanel access={stay.access} />
    </div>
  );

  return (
    <div className="safe-top">
      {/* Phones: the original composition; desktop: greeting and tiles side by side. */}
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BrandHeader property={stay.property} />

        <main>
          <div className="mt-6 grid gap-5 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-12">
            <div className="lg:col-span-7">
              <Greeting firstName={stay.guest.firstName} upcoming={stay.upcoming} />
            </div>
            <div className="lg:col-span-5">
              <StayTiles start={stay.tiles.start} accent={stay.tiles.accent} />
            </div>
          </div>

          {/* Arrival day: how to get in comes first. Afterwards it moves below the photo cards,
              so the screen keeps the original composition (tiles, then photos). */}
          {accessFirst && accessPanel}

          <div className="mt-2 lg:mt-12">
            <StayCards cards={stay.cards} />
          </div>

          {!accessFirst && accessPanel}
        </main>
      </Container>
    </div>
  );
}
