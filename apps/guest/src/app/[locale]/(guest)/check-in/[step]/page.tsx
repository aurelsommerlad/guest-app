import { localDateOf, MAX_TRAVELLERS } from "@up/core";
import { DetailList } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  saveStepAction,
  submitCheckInAction,
  confirmTripAction,
} from "../../../../../features/check-in/actions";
import {
  checkInAvailability,
  reservationGuestCount,
} from "../../../../../features/check-in/check-in-service";
import { CheckInShell } from "../../../../../features/check-in/components/CheckInShell";
import { GuestStepForm } from "../../../../../features/check-in/components/GuestStepForm";
import { ReviewSummary } from "../../../../../features/check-in/components/ReviewSummary";
import { SubmitForm } from "../../../../../features/check-in/components/SubmitForm";
import { TripForm } from "../../../../../features/check-in/components/TripForm";
import { countryOptions } from "../../../../../features/check-in/countries";
import {
  buildStepForm,
  isCheckInStep,
  visibleSteps,
} from "../../../../../features/check-in/form-model";
import { checkInDeps } from "../../../../../features/check-in/server";
import { requireGuestContext } from "../../../../../features/guest-context/server";
import { redirect } from "../../../../../i18n/navigation";
import { routing } from "../../../../../i18n/routing";

type Props = { params: Promise<{ locale: string; step: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.checkIn"), robots: { index: false, follow: false } };
}

/** One step of the online check-in. Progress is saved per step; the guest can resume. */
export default async function CheckInStepPage({ params }: Props) {
  const { locale, step } = await params;
  if (!hasLocale(routing.locales, locale) || !isCheckInStep(step)) notFound();
  const context = await requireGuestContext(locale);
  const availability = await checkInAvailability(checkInDeps(), context);
  if (!availability.available) return redirect({ href: "/check-in", locale });
  const { journey } = availability;
  const { registration, assessment } = journey;
  const toEntry = () => redirect({ href: "/check-in", locale });
  if (registration?.status === "submitted") return toEntry();
  if (assessment.steps[step] === "skipped") return toEntry();
  if (step !== "trip" && !registration) return redirect({ href: "/check-in/trip", locale });
  if (step === "review" && !assessment.readyToSubmit) return toEntry();

  const t = await getTranslations("checkIn");
  const steps = visibleSteps(journey);
  const countries = countryOptions(locale);
  const timeZone = journey.window.timeZone;
  const dateTime = (iso: string) =>
    t("trip.dateTime", {
      date: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone }).format(new Date(iso)),
      time: new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(new Date(iso)),
    });

  let content;
  if (step === "trip") {
    const fromReservation = reservationGuestCount(context);
    const count = fromReservation ?? registration?.guestCount;
    const unitName =
      context.reservation.status === "loaded" ? context.reservation.source.unit.name : undefined;
    content = (
      <div className="flex flex-col gap-8">
        <DetailList
          items={[
            {
              id: "arrival",
              icon: "calendar",
              label: t("trip.arrival"),
              value: dateTime(journey.window.checkInAt),
            },
            {
              id: "departure",
              icon: "calendar",
              label: t("trip.departure"),
              value: dateTime(journey.window.checkOutAt),
            },
            ...(unitName
              ? [{ id: "unit", icon: "home" as const, label: t("trip.apartment"), value: unitName }]
              : []),
            ...(fromReservation === undefined
              ? []
              : [
                  {
                    id: "travellers",
                    icon: "heart" as const,
                    label: t("trip.travellers"),
                    value: `${t("trip.travellersCount", { count: fromReservation })}\n${t("trip.travellersHint")}`,
                  },
                ]),
          ]}
        />
        <TripForm
          action={confirmTripAction.bind(null, locale)}
          askGuestCount={fromReservation === undefined}
          {...(count === undefined ? {} : { guestCount: count })}
          maxTravellers={MAX_TRAVELLERS}
        />
      </div>
    );
  } else if (step === "review") {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    content = (
      <div className="flex flex-col gap-8">
        <ReviewSummary
          journey={journey}
          steps={steps}
          countryName={(code) => names.of(code) ?? code}
          formatDate={(isoDate) =>
            new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
              new Date(`${isoDate}T00:00:00Z`),
            )
          }
        />
        <SubmitForm
          action={submitCheckInAction.bind(null, locale)}
          version={registration?.version ?? 0}
        />
      </div>
    );
  } else {
    content = (
      <GuestStepForm
        action={saveStepAction.bind(null, locale, step)}
        fieldsets={buildStepForm(journey, step)}
        version={registration?.version ?? 0}
        countries={countries}
        documentTypes={(["passport", "id-card", "other"] as const).map((value) => ({
          value,
          label: t(`documentTypes.${value}`),
        }))}
        maxBirthDate={localDateOf(new Date(), timeZone)}
      />
    );
  }

  return (
    <CheckInShell steps={steps} current={step}>
      {content}
    </CheckInShell>
  );
}
