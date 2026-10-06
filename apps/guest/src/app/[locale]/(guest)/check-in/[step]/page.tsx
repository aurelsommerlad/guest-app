import { localDateOf } from "@up/core";
import { callingCodeOptions } from "@up/core/phone";
import { Icon, SummaryCard } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  saveStepAction,
  submitCheckInAction,
  confirmTripAction,
} from "../../../../../features/check-in/actions";
import { checkInAvailability } from "../../../../../features/check-in/check-in-service";
import { CheckInShell } from "../../../../../features/check-in/components/CheckInShell";
import { GuestStepForm } from "../../../../../features/check-in/components/GuestStepForm";
import { ReviewSummary } from "../../../../../features/check-in/components/ReviewSummary";
import { SubmitForm } from "../../../../../features/check-in/components/SubmitForm";
import { TripForm } from "../../../../../features/check-in/components/TripForm";
import { countryOptions } from "../../../../../features/check-in/countries";
import {
  buildStepForm,
  isCheckInStep,
  LEGACY_STEPS,
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
  if (!hasLocale(routing.locales, locale)) notFound();
  const legacy = LEGACY_STEPS[step];
  if (legacy) return redirect({ href: `/check-in/${legacy}`, locale });
  if (!isCheckInStep(step)) notFound();
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
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "long",
      timeZone,
    }).format(new Date(iso));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(new Date(iso));
  const dateAndTime = (iso: string) => (
    <>
      <span className="block">{date(iso)}</span>
      <span className="type-small block text-text-muted">{time(iso)}</span>
    </>
  );
  const index = steps.indexOf(step);
  const previous = index > 0 ? steps[index - 1] : undefined;
  const backHref = previous ? `/check-in/${previous}` : "/stay";
  const hasDocument =
    step === "address" &&
    buildStepForm(journey, "address")[0]?.fields.some(
      (def) => def.field === "documentType" || def.field === "documentNumber",
    ) === true;
  const title = hasDocument ? t("addressWithDocumentTitle") : t(`steps.${step}`);

  let content;
  if (step === "trip") {
    const travellers =
      context.reservation.status === "loaded"
        ? context.reservation.source.reservation.guestCount
        : undefined;
    const unitName =
      context.reservation.status === "loaded" ? context.reservation.source.unit.name : undefined;
    content = (
      <div className="flex flex-col gap-4">
        <SummaryCard
          title={t("trip.card")}
          icon="calendar"
          groups={[
            {
              id: "stay",
              items: [
                {
                  id: "arrival",
                  label: t("trip.arrival"),
                  value: dateAndTime(journey.window.checkInAt),
                },
                {
                  id: "departure",
                  label: t("trip.departure"),
                  value: dateAndTime(journey.window.checkOutAt),
                },
                ...(unitName ? [{ id: "unit", label: t("trip.apartment"), value: unitName }] : []),
                ...(travellers
                  ? [
                      {
                        id: "travellers",
                        label: t("trip.travellers"),
                        value: (
                          <>
                            <span className="block">
                              {t("trip.travellersCount", {
                                count: travellers.adults + travellers.children,
                              })}
                            </span>
                            <span className="type-small block text-text-muted">
                              {t("trip.travellersBreakdown", {
                                adults: travellers.adults,
                                children: travellers.children,
                              })}
                            </span>
                          </>
                        ),
                      },
                    ]
                  : []),
              ],
            },
          ]}
        />
        <p className="type-caption flex items-start gap-2 px-1 text-text-muted">
          <Icon name="info" size="sm" className="mt-px shrink-0" />
          <span>{t("trip.editHint")}</span>
        </p>
        <TripForm action={confirmTripAction.bind(null, locale)} />
      </div>
    );
  } else if (step === "review") {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    content = (
      <div className="flex flex-col gap-6">
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
        step={step}
        fieldsets={buildStepForm(journey, step)}
        version={registration?.version ?? 0}
        countries={countries}
        callingCodes={callingCodeOptions(locale)}
        {...(registration?.guestCountChangedAt
          ? { occupancyChangedTo: registration.guestCount }
          : {})}
        documentTypes={(["passport", "id-card", "other"] as const).map((value) => ({
          value,
          label: t(`documentTypes.${value}`),
        }))}
        maxBirthDate={localDateOf(new Date(), timeZone)}
      />
    );
  }

  return (
    <CheckInShell
      steps={steps.map((id) => ({ id, state: assessment.steps[id] }))}
      current={step}
      backHref={backHref}
      title={title}
      intro={t(`intro.${step}`)}
    >
      {content}
    </CheckInShell>
  );
}
