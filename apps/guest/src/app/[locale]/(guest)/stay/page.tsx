import { Container } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BrandHeader } from "../../../../components/GuestHeader";
import { AccessPanel } from "../../../../features/stay/components/AccessPanel";
import { CheckInCard } from "../../../../features/stay/components/CheckInCard";
import { Greeting } from "../../../../features/stay/components/Greeting";
import { StayCards } from "../../../../features/stay/components/StayCards";
import { StayInfoGrid } from "../../../../features/stay/components/StayInfoGrid";
import { StayLinks } from "../../../../features/stay/components/StayLinks";
import { StaySummaryCard } from "../../../../features/stay/components/StaySummaryCard";
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

  const [stay, t] = await Promise.all([getStay(locale), getTranslations("stay")]);
  const accessCard = stay.access ? (
    <AccessPanel access={stay.access} />
  ) : stay.accessPreview ? (
    <AccessPanel preview={stay.accessPreview} />
  ) : undefined;

  return (
    <div className="safe-top">
      {/* Tablet keeps the phone composition in a calm centered column; desktop gets its own grid. */}
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BrandHeader property={stay.property} />

        <main>
          <div className="mt-6 grid gap-5 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-12">
            <div className="lg:col-span-7">
              <Greeting firstName={stay.guest.firstName} upcoming={stay.upcoming} />
            </div>
            <div className="lg:col-span-5">
              {stay.upcoming ? (
                <StaySummaryCard summary={stay.summary} />
              ) : (
                <StayInfoGrid status={stay.timeTile} unit={stay.unit} />
              )}
            </div>
          </div>

          {(stay.checkIn ?? accessCard) && (
            <div className="mt-3 grid items-start gap-3 lg:mt-8 lg:grid-cols-2">
              {stay.checkIn && <CheckInCard card={stay.checkIn} />}
              {accessCard}
            </div>
          )}

          <div className="mt-6 lg:mt-12">
            {/* Phones: compact cards; desktop: the three photo cards side by side. */}
            <div className="lg:hidden">
              <StayLinks cards={stay.cards} heading={t("linksHeading")} />
            </div>
            <div className="hidden lg:block">
              <StayCards cards={stay.cards} />
            </div>
          </div>
        </main>
      </Container>
    </div>
  );
}
