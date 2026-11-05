import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { requireGuestContext } from "../../../../../features/guest-context/server";
import { buildPaymentView } from "../../../../../features/payment/payment-view";
import { getPayment } from "../../../../../features/payment/server";
import { getStay } from "../../../../../features/stay/get-stay";
import { routing } from "../../../../../i18n/routing";
import { V2Header } from "../../../../../v2/components/V2Header";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return { title: t("v2.payment.eyebrow"), robots: { index: false, follow: false } };
}

/**
 * Booking & payment overview (Phase 12 A, read-only): services, payments, refunds and the
 * open amount – live from the provider, evaluated on the server. No payment can be started
 * here yet (Phase B); nothing is stored, no card data ever passes through the app.
 */
export default async function V2PaymentPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await requireGuestContext(locale);
  const payment = await getPayment(context);
  if (!payment) notFound();
  const stay = await getStay(locale);
  const t = await getTranslations("v2.payment");
  const view = buildPaymentView(payment.evaluation, locale, context.property.timeZone);
  const showAmounts = view.state !== "unknown" && view.state !== "review" && view.totals;
  const openAmount = view.totals?.open;

  return (
    <div className="v2-page">
      <V2Header />
      <main>
        <section className="v2-intro v2-margin">
          <p className="v2-eyebrow">{t("eyebrow")}</p>
          <h1 className="v2-display">{t("title")}</h1>
          <p className="v2-lead v2-muted">
            {stay.unit.name} · {stay.summary.dates}
          </p>
        </section>

        <section aria-labelledby="v2-pay-status" className="v2-section v2-margin">
          <div className="v2-status" role="status">
            <h2 id="v2-pay-status" className="v2-eyebrow v2-muted">
              {view.state === "credit"
                ? t("credit")
                : view.state === "review" || view.state === "unknown"
                  ? t("payment")
                  : t("open")}
            </h2>
            {showAmounts && (
              <p className="v2-figure">
                {view.state === "credit" ? view.totals?.credit : openAmount}
              </p>
            )}
            <p className="v2-text">
              {view.state === "not-due"
                ? t("status.not-due", { date: view.dueAt ?? "" })
                : t(`status.${view.state}`)}
            </p>
            {(view.state === "review" || view.state === "unknown") && (
              <p className="v2-small v2-muted">{t(`help.${view.state}`)}</p>
            )}
            {(view.state === "due" || view.state === "not-due") && (
              <p className="v2-small v2-muted">{t("payNote")}</p>
            )}
            {view.freeCancellationUntil &&
              view.freeCancellationUntil !== view.dueAt &&
              view.state === "not-due" && (
                <p className="v2-small v2-muted">
                  {t("freeCancellation", { date: view.freeCancellationUntil })}
                </p>
              )}
          </div>
          {view.thirdParty && (
            <p className="v2-small v2-muted" style={{ marginTop: 14 }}>
              {t("thirdParty")}
            </p>
          )}
        </section>

        {showAmounts && view.lines.length > 0 && (
          <section aria-labelledby="v2-pay-services" className="v2-section v2-margin">
            <h2 id="v2-pay-services" className="v2-section-head v2-eyebrow">
              {t("services")}
            </h2>
            <ul className="v2-rows">
              {view.lines.map((line) => (
                <li key={line.id} className="v2-item">
                  <span className="v2-stack" style={{ gap: 3 }}>
                    <span className="v2-text">{line.name}</span>
                    {line.date && <span className="v2-small v2-muted">{line.date}</span>}
                  </span>
                  <span className="v2-item-amount">{line.amount}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showAmounts && (view.payments.length > 0 || view.refunds.length > 0) && (
          <section aria-labelledby="v2-pay-payments" className="v2-section v2-margin">
            <h2 id="v2-pay-payments" className="v2-section-head v2-eyebrow">
              {t("payments")}
            </h2>
            <ul className="v2-rows">
              {view.payments.map((item) => (
                <li key={item.id} className="v2-item">
                  <span className="v2-stack" style={{ gap: 3 }}>
                    <span className="v2-text">{item.label ?? t("payment")}</span>
                    <span className="v2-small v2-muted">
                      {[item.date, item.pending ? t("inProgress") : undefined]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="v2-item-amount">{item.amount}</span>
                </li>
              ))}
              {view.refunds.map((item) => (
                <li key={item.id} className="v2-item">
                  <span className="v2-stack" style={{ gap: 3 }}>
                    <span className="v2-text">{t("refund")}</span>
                    <span className="v2-small v2-muted">
                      {[item.date, item.pending ? t("inProgress") : undefined]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="v2-item-amount">− {item.amount}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showAmounts && view.totals && (
          <section aria-labelledby="v2-pay-summary" className="v2-section v2-margin">
            <h2 id="v2-pay-summary" className="v2-section-head v2-eyebrow">
              {t("summary")}
            </h2>
            <dl className="v2-rows">
              <div className="v2-item">
                <dt className="v2-text">{t("charged")}</dt>
                <dd className="v2-item-amount">{view.totals.charged}</dd>
              </div>
              <div className="v2-item">
                <dt className="v2-text">{t("paid")}</dt>
                <dd className="v2-item-amount">{view.totals.paid}</dd>
              </div>
              {view.totals.pending && (
                <div className="v2-item">
                  <dt className="v2-text">{t("pending")}</dt>
                  <dd className="v2-item-amount">{view.totals.pending}</dd>
                </div>
              )}
              {view.totals.refunded && (
                <div className="v2-item">
                  <dt className="v2-text">{t("refunded")}</dt>
                  <dd className="v2-item-amount">{view.totals.refunded}</dd>
                </div>
              )}
              <div className="v2-item v2-item--total">
                <dt className="v2-text">{view.totals.credit ? t("credit") : t("open")}</dt>
                <dd className="v2-item-amount">{view.totals.credit ?? view.totals.open}</dd>
              </div>
            </dl>
            <p className="v2-caption" style={{ marginTop: 14 }}>
              {t("privacy")}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
