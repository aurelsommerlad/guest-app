import { Container } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BrandHeader } from "../../../../components/GuestHeader";
import { Greeting } from "../../../../features/stay/components/Greeting";
import { StayCards } from "../../../../features/stay/components/StayCards";
import { StayInfoGrid } from "../../../../features/stay/components/StayInfoGrid";
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

  const stay = getStay(locale);

  return (
    <div className="safe-top">
      {/* Tablet keeps the phone composition in a calm centered column; desktop gets its own grid. */}
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BrandHeader property={stay.property} />

        <main>
          <div className="mt-6 grid gap-5 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-12">
            <div className="lg:col-span-7">
              <Greeting firstName={stay.guest.firstName} />
            </div>
            <div className="lg:col-span-5">
              <StayInfoGrid status={stay.status} unit={stay.unit} />
            </div>
          </div>

          <div className="mt-3 lg:mt-12">
            <StayCards cards={stay.cards} />
          </div>
        </main>
      </Container>
    </div>
  );
}
