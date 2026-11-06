import { localDateOf } from "@up/core";
import { callingCodeOptions } from "@up/core/phone";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { checkInAvailability } from "../../../../../../features/check-in/check-in-service";
import { countryOptions } from "../../../../../../features/check-in/countries";
import {
  buildBillingForm,
  buildStepForm,
  isCheckInStep,
  LEGACY_STEPS,
  visibleSteps,
} from "../../../../../../features/check-in/form-model";
import { checkInDeps } from "../../../../../../features/check-in/server";
import { requireGuestContext } from "../../../../../../features/guest-context/server";
import { redirect } from "../../../../../../i18n/navigation";
import { routing } from "../../../../../../i18n/routing";
import {
  confirmTripV2,
  saveBillingV2,
  saveStepV2,
  submitCheckInV2,
} from "../../../../../../v2/check-in/actions";
import { V2CheckInShell } from "../../../../../../v2/check-in/V2CheckInShell";
import {
  V2BillingForm,
  V2GuestStepForm,
  V2SubmitForm,
  V2TripForm,
} from "../../../../../../v2/check-in/V2Forms";
import { V2Review } from "../../../../../../v2/check-in/V2Review";

type Props = { params: Promise<{ locale: string; step: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.checkIn"), robots: { index: false, follow: false } };
}

/**
 * One step of the V2 online check-in. Same guards, data and saving as the current app's
 * step page (check-in service, form model, shared action handlers) – only the design differs.
 */
export default async function V2CheckInStepPage({ params }: Props) {
  const { locale, step } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const legacy = LEGACY_STEPS[step];
  if (legacy) return redirect({ href: `/v2/check-in/${legacy}`, locale });
  if (!isCheckInStep(step)) notFound();
  const context = await requireGuestContext(locale);
  const availability = await checkInAvailability(checkInDeps(), context);
  const toEntry = () => redirect({ href: "/v2/check-in", locale });
  if (!availability.available) return toEntry();
  const { journey } = availability;
  const { registration, assessment } = journey;
  if (registration?.status === "submitted") return toEntry();
  if (assessment.steps[step] === "skipped") return toEntry();
  if (step !== "trip" && !registration) return redirect({ href: "/v2/check-in/trip", locale });
  if (step === "review" && !assessment.readyToSubmit) return toEntry();

  const t = await getTranslations("checkIn");
  const v2 = await getTranslations("v2.apartment");
  const steps = visibleSteps(journey);
  const timeZone = journey.window.timeZone;
  const index = steps.indexOf(step);
  const previous = index > 0 ? steps[index - 1] : undefined;
  const backHref = previous ? `/v2/check-in/${previous}` : "/v2";
  const hasDocument =
    step === "address" &&
    buildStepForm(journey, "address")[0]?.fields.some(
      (def) => def.field === "documentType" || def.field === "documentNumber",
    ) === true;
  const title = hasDocument ? t("addressWithDocumentTitle") : t(`steps.${step}`);

  let content;
  if (step === "trip") {
    const date = (iso: string) =>
      new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(
        new Date(iso),
      );
    const weekday = (iso: string) =>
      new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(new Date(iso));
    const time = (iso: string) =>
      new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(new Date(iso));
    const source = context.reservation.status === "loaded" ? context.reservation.source : undefined;
    const travellers = source?.reservation.guestCount;
    content = (
      <div className="v2-stack" style={{ gap: 32 }}>
        <div>
          <div className="v2-pair">
            <div className="v2-stack v2-stack-2">
              <span className="v2-eyebrow v2-muted">{t("trip.arrival")}</span>
              <span className="v2-date">{date(journey.window.checkInAt)}</span>
              <span className="v2-small">
                {weekday(journey.window.checkInAt)} ·{" "}
                {v2("checkInFrom", { time: time(journey.window.checkInAt) })}
              </span>
            </div>
            <div className="v2-stack v2-stack-2">
              <span className="v2-eyebrow v2-muted">{t("trip.departure")}</span>
              <span className="v2-date">{date(journey.window.checkOutAt)}</span>
              <span className="v2-small">
                {weekday(journey.window.checkOutAt)} ·{" "}
                {v2("checkOutUntil", { time: time(journey.window.checkOutAt) })}
              </span>
            </div>
          </div>
          <dl className="v2-rows">
            {source && (
              <div className="v2-row">
                <dt>{t("trip.apartment")}</dt>
                <dd className="v2-text">{source.unit.name}</dd>
              </div>
            )}
            {travellers && (
              <div className="v2-row">
                <dt>{t("trip.travellers")}</dt>
                <dd className="v2-text">
                  {t("trip.travellersCount", { count: travellers.adults + travellers.children })}
                  <span className="v2-small v2-muted block" style={{ marginTop: 4 }}>
                    {t("trip.travellersBreakdown", {
                      adults: travellers.adults,
                      children: travellers.children,
                    })}
                  </span>
                </dd>
              </div>
            )}
          </dl>
          <p className="v2-caption" style={{ marginTop: 14 }}>
            {t("trip.editHint")}
          </p>
        </div>
        <V2TripForm action={confirmTripV2.bind(null, locale)} />
      </div>
    );
  } else if (step === "review") {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    content = (
      <div className="v2-stack" style={{ gap: 40 }}>
        <V2Review
          journey={journey}
          steps={steps}
          countryName={(code) => names.of(code) ?? code}
          formatDate={(isoDate) =>
            new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
              new Date(`${isoDate}T00:00:00Z`),
            )
          }
        />
        <V2SubmitForm
          action={submitCheckInV2.bind(null, locale)}
          version={registration?.version ?? 0}
        />
      </div>
    );
  } else if (step === "billing") {
    content = (
      <V2BillingForm
        action={saveBillingV2.bind(null, locale)}
        form={buildBillingForm(journey)}
        version={registration?.version ?? 0}
        countries={countryOptions(locale)}
      />
    );
  } else {
    content = (
      <V2GuestStepForm
        action={saveStepV2.bind(null, locale, step)}
        step={step}
        fieldsets={buildStepForm(journey, step)}
        version={registration?.version ?? 0}
        countries={countryOptions(locale)}
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
    <V2CheckInShell
      steps={steps.map((id) => ({ id, state: assessment.steps[id] }))}
      current={step}
      backHref={backHref}
      title={title}
      intro={t(`intro.${step}`)}
    >
      {content}
    </V2CheckInShell>
  );
}
