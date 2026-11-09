/**
 * Text of an offer's price and duration (pure, shared by the overview, the home module and the
 * detail page). Whole amounts without decimals – prices are quiet text, not shop labels.
 */
import { type CancellationPolicy } from "@up/core";
import type { getTranslations } from "next-intl/server";

import { type OfferPriceView } from "../../features/upsell/offer-view";

/** Translator scoped to "services". */
export type ServicesT = Awaited<ReturnType<typeof getTranslations<"services">>>;

export function formatMoney(amountCents: number, currency: string, locale: string): string {
  const whole = amountCents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amountCents / 100);
}

export function formatOfferPrice(price: OfferPriceView, t: ServicesT, locale: string): string {
  if (price.kind !== "amount") return t(`price.${price.kind}`);
  if (price.amountCents === 0) return t("price.free");
  const money = formatMoney(price.amountCents, price.currency, locale);
  const amount = price.unitLabel
    ? `${money} ${price.unitLabel}`
    : t(`price.per.${price.per}`, { amount: money });
  return price.from ? t("price.from", { amount }) : amount;
}

export function formatDuration(minutes: number, t: ServicesT): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("facts.minutes", { count: rest });
  if (rest === 0) return t("facts.hours", { count: hours });
  return `${t("facts.hours", { count: hours })} ${t("facts.minutes", { count: rest })}`;
}

export function formatCancellation(policy: CancellationPolicy, t: ServicesT): string {
  if (policy.type !== "free-until") return t(`cancellation.${policy.type}`);
  return policy.hoursBefore >= 48 && policy.hoursBefore % 24 === 0
    ? t("cancellation.free-until-days", { days: policy.hoursBefore / 24 })
    : t("cancellation.free-until", { hours: policy.hoursBefore });
}
