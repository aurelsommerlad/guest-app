import { Icon } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { checkInAvailability } from "../../../../../features/check-in/check-in-service";
import { visibleSteps } from "../../../../../features/check-in/form-model";
import { nextStepsAfterCheckIn } from "../../../../../features/check-in/next-steps";
import { checkInDeps } from "../../../../../features/check-in/server";
import { requireGuestContext } from "../../../../../features/guest-context/server";
import { Link, redirect } from "../../../../../i18n/navigation";
import { routing } from "../../../../../i18n/routing";
import { V2Arrow } from "../../../../../v2/components/glyphs";
import { V2CheckInShell } from "../../../../../v2/check-in/V2CheckInShell";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("metadata.checkIn"), robots: { index: false, follow: false } };
}

/** V2 entry of the online check-in: done, unavailable, or on to the next open step. */
export default async function V2CheckInPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await requireGuestContext(locale);
  const availability = await checkInAvailability(checkInDeps(), context);
  const t = await getTranslations("checkIn");
  const v2 = await getTranslations("v2.checkIn");
  if (!availability.available) {
    return (
      <V2CheckInShell title={t("unavailable.title")} intro={t("unavailable.body")}>
        <Link href="/v2" className="v2-button v2-button--ghost">
          <span>{v2("toStay")}</span>
          <V2Arrow />
        </Link>
      </V2CheckInShell>
    );
  }
  const { journey } = availability;
  if (journey.registration?.status !== "submitted") {
    return redirect({ href: `/v2/check-in/${journey.assessment.nextStep}`, locale });
  }
  const done = await getTranslations("checkIn.done");
  const timeZone = journey.window.timeZone;
  const next = nextStepsAfterCheckIn(journey, {
    time: (iso) =>
      new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(new Date(iso)),
    date: (iso) =>
      new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(
        new Date(iso),
      ),
  }).map((step) => ({ id: step.id, icon: step.icon, text: done(step.key, step.values ?? {}) }));
  const firstName =
    context.reservation.status === "loaded"
      ? context.reservation.source.guest.firstName
      : undefined;
  return (
    <V2CheckInShell
      steps={visibleSteps(journey).map((id) => ({ id, state: journey.assessment.steps[id] }))}
      allComplete
      title={done("title")}
      intro={firstName ? done("body", { firstName }) : done("bodyWithoutName")}
    >
      {next.length > 0 && (
        <section aria-labelledby="v2-next" className="v2-stack">
          <h2 id="v2-next" className="v2-section-head v2-eyebrow">
            {done("nextTitle")}
          </h2>
          <ul className="v2-rows">
            {next.map((item) => (
              <li
                key={item.id}
                className="v2-link"
                style={{ justifyContent: "flex-start", gap: 16, padding: "14px 0" }}
              >
                <span className="v2-mark" aria-hidden>
                  <Icon name={item.icon} />
                </span>
                <span className="v2-body">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div style={{ marginTop: 32 }}>
        <Link href="/v2" className="v2-button">
          <span>{v2("toStay")}</span>
          <V2Arrow />
        </Link>
      </div>
    </V2CheckInShell>
  );
}
