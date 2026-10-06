import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { checkInAvailability } from "../../../../features/check-in/check-in-service";
import { CheckInShell } from "../../../../features/check-in/components/CheckInShell";
import {
  CheckInDone,
  CheckInUnavailable,
} from "../../../../features/check-in/components/CheckInStates";
import { visibleSteps } from "../../../../features/check-in/form-model";
import { nextStepsAfterCheckIn } from "../../../../features/check-in/next-steps";
import { checkInDeps } from "../../../../features/check-in/server";
import { requireGuestContext } from "../../../../features/guest-context/server";
import { redirect } from "../../../../i18n/navigation";
import { routing } from "../../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.checkIn"), robots: { index: false, follow: false } };
}

/** Entry of the online check-in: done, unavailable, or on to the next open step. */
export default async function CheckInPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await requireGuestContext(locale);
  const availability = await checkInAvailability(checkInDeps(), context);
  if (!availability.available) {
    return (
      <CheckInShell>
        <CheckInUnavailable />
      </CheckInShell>
    );
  }
  const { journey } = availability;
  if (journey.registration?.status === "submitted") {
    const t = await getTranslations("checkIn.done");
    const timeZone = journey.window.timeZone;
    const next = nextStepsAfterCheckIn(journey, {
      time: (iso) =>
        new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(new Date(iso)),
      date: (iso) =>
        new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(
          new Date(iso),
        ),
    }).map((step) => ({ id: step.id, icon: step.icon, text: t(step.key, step.values ?? {}) }));
    const firstName =
      context.reservation.status === "loaded"
        ? context.reservation.source.guest.firstName
        : undefined;
    return (
      <CheckInShell
        steps={visibleSteps(journey).map((id) => ({ id, state: journey.assessment.steps[id] }))}
        allComplete
      >
        <CheckInDone {...(firstName ? { firstName } : {})} next={next} />
      </CheckInShell>
    );
  }
  return redirect({ href: `/check-in/${journey.assessment.nextStep}`, locale });
}
