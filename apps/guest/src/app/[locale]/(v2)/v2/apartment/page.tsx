import { PropertyName } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";

import { requireGuestContext } from "../../../../../features/guest-context/server";
import { getPayment } from "../../../../../features/payment/server";
import { getStay } from "../../../../../features/stay/get-stay";
import { Link } from "../../../../../i18n/navigation";
import { routing } from "../../../../../i18n/routing";
import { V2Arrow } from "../../../../../v2/components/glyphs";
import { V2AccessReveal } from "../../../../../v2/components/V2AccessReveal";
import { V2Header } from "../../../../../v2/components/V2Header";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("v2.apartment.eyebrow") };
}

/**
 * V2 "Apartment & Zugang": the apartment, the stay's times, access (code only on request,
 * via the same server action and rules as the current app), arrival notes and next actions.
 */
export default async function V2ApartmentPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const stay = await getStay(locale);
  const payment = await getPayment(await requireGuestContext(locale));
  const paymentState = payment?.evaluation.state;
  // Phase 12 A: inform only – the access itself is not gated by payments yet.
  const paymentNotice =
    paymentState === "due" ||
    paymentState === "pending" ||
    paymentState === "review" ||
    paymentState === "unknown";
  const p = await getTranslations("v2.payment");
  const t = await getTranslations("v2.apartment");
  const a = await getTranslations("stay.access");
  const s = await getTranslations("stay");
  const { checkIn, checkOut } = stay.times;
  const access = stay.access;
  const preview = stay.accessPreview;
  const openCheckIn = stay.checkIn && stay.checkIn.state !== "completed";
  const travellers = stay.summary.travellers;

  return (
    <div className="v2-page">
      <V2Header />
      <main>
        <section className="v2-intro v2-margin">
          <p className="v2-eyebrow">{t("eyebrow")}</p>
          <h1 className="v2-display v2-display-hero">{stay.unit.name}</h1>
          <p className="v2-lead v2-muted">
            <PropertyName name={stay.property.name} spokenName={stay.property.spokenName} />
            {" · "}
            {stay.property.location}
          </p>
        </section>

        {stay.summary.image && (
          <div className="v2-inset">
            <div className="v2-hero">
              <Image
                src={stay.summary.image.src}
                alt={stay.summary.image.alt}
                fill
                sizes="(min-width: 600px) 560px, 100vw"
                preload
                style={{
                  objectFit: "cover",
                  ...(stay.summary.image.focus ? { objectPosition: stay.summary.image.focus } : {}),
                }}
              />
            </div>
          </div>
        )}

        <section aria-label={s("infoHeading")} className="v2-section v2-margin">
          <div className="v2-pair">
            <div className="v2-stack v2-stack-2">
              <span className="v2-eyebrow v2-muted">{t("arrival")}</span>
              <span className="v2-date">
                <time dateTime={checkIn.dateTime}>{checkIn.date}</time>
              </span>
              <span className="v2-small">{t("checkInFrom", { time: checkIn.time })}</span>
            </div>
            <div className="v2-stack v2-stack-2">
              <span className="v2-eyebrow v2-muted">{t("departure")}</span>
              <span className="v2-date">
                <time dateTime={checkOut.dateTime}>{checkOut.date}</time>
              </span>
              <span className="v2-small">{t("checkOutUntil", { time: checkOut.time })}</span>
            </div>
          </div>
          {travellers && (
            <dl className="v2-rows">
              <div className="v2-row">
                <dt>{t("travellers")}</dt>
                <dd className="v2-text">
                  {s("summary.travellers", {
                    adults: travellers.adults,
                    children: travellers.children,
                  })}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section id="zugang" aria-labelledby="v2-access" className="v2-section v2-margin">
          <div className="v2-section-head">
            <h2 id="v2-access" className="v2-eyebrow">
              {t("access")}
            </h2>
          </div>
          <div className="v2-stack v2-stack-6" style={{ paddingTop: 22 }}>
            {paymentNotice && (
              <Link href="/v2/payment" className="v2-notice v2-link" style={{ minHeight: 0 }}>
                <span>
                  {paymentState === "due" ? p("accessNotice") : p(`status.${paymentState}`)}
                </span>
                <V2Arrow />
              </Link>
            )}
            {access?.kind === "available" && (
              <>
                <div className="v2-stack v2-stack-2">
                  <p className="v2-date">{a(`type.${access.credentialType}`)}</p>
                  <p className="v2-small v2-muted">
                    {a("validFrom", { time: access.validFrom.time, date: access.validFrom.date })}
                  </p>
                </div>
                <V2AccessReveal />
                {access.instructions && <p className="v2-body">{access.instructions}</p>}
              </>
            )}
            {access?.kind === "manual" && (
              <p className="v2-body">{access.instructions ?? a("manualDefault")}</p>
            )}
            {access?.kind === "registration-required" && (
              <>
                <p className="v2-body">{a("registrationRequired")}</p>
                <Link href="/v2/check-in" className="v2-button">
                  <span>{a("registrationRequiredLink")}</span>
                  <V2Arrow />
                </Link>
              </>
            )}
            {access?.kind === "not-yet-released" && (
              <p className="v2-body">
                {a("notYetReleased", { time: access.time, date: access.date })}
              </p>
            )}
            {access?.kind === "not-issued" && <p className="v2-body">{a("notIssued")}</p>}
            {!access && preview && (
              <p className="v2-body">
                {preview.withTime
                  ? a("previewWithTime", { time: preview.time, date: preview.date })
                  : a("previewDate", { date: preview.date })}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="v2-more" className="v2-section v2-margin">
          <div className="v2-section-head">
            <h2 id="v2-more" className="v2-eyebrow">
              {t("more")}
            </h2>
          </div>
          {stay.checkIn &&
            (openCheckIn ? (
              <Link href="/v2/check-in" className="v2-link v2-text">
                <span>{t("checkIn")}</span>
                <V2Arrow />
              </Link>
            ) : (
              <p className="v2-link v2-text v2-muted">{t("checkInDone")}</p>
            ))}
          {payment && (
            <Link href="/v2/payment" className="v2-link v2-text">
              <span>{p("link")}</span>
              <V2Arrow />
            </Link>
          )}
          <Link href="/guide" className="v2-link v2-text">
            <span>{t("guide")}</span>
            <V2Arrow />
          </Link>
        </section>
      </main>
    </div>
  );
}
