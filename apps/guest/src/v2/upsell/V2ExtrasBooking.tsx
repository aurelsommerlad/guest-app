"use client";

/**
 * Booking an own service inside STAY (upselling Phase 2): the binding price from Extras, the
 * extra details Extras needs (quantity, licence plates), one clear action and the outcome.
 * Nothing here decides availability or price – the server actions ask Extras, which checks
 * everything again right before it books into Apaleo.
 */
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  bookExtraAction,
  extendStayAction,
  requestExtraAction,
} from "../../features/extras/actions";
import type { BookingOutcome } from "../../features/extras/booking-service";
import type { ExtrasBookingView } from "../../features/upsell/extras-merge";
import { Link } from "../../i18n/navigation";
import { V2Arrow } from "../components/glyphs";

function money(cents: number, currency: string, locale: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

function day(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function period(dates: string[], locale: string): string {
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return "";
  return first === last ? day(first, locale) : `${day(first, locale)} – ${day(last, locale)}`;
}

type Done = Extract<BookingOutcome, { kind: "booked" | "requested" | "extended" }>;

export function V2ExtrasBooking({ booking, title }: { booking: ExtrasBookingView; title: string }) {
  const t = useTranslations("services.booking");
  const priceText = useTranslations("services.price");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // One key per confirmation: a retry of the same click never books twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [count, setCount] = useState(1);
  const [plates, setPlates] = useState<string[]>(
    booking.kind === "service" && booking.existingPlate ? [booking.existingPlate] : [""],
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const total = useMemo(() => {
    if (booking.kind === "extension") return booking.totalCents;
    return booking.unitCents === null ? null : booking.unitCents * booking.nights * count;
  }, [booking, count]);
  const currency = booking.currency;

  if (done) {
    const heading =
      done.kind === "booked"
        ? t("done.booked")
        : done.kind === "requested"
          ? t("done.requested")
          : t("done.extended");
    const text =
      done.kind === "booked"
        ? t("done.bookedText", { service: title })
        : done.kind === "requested"
          ? t("done.requestedText")
          : t("done.extendedText", { date: day(done.newDeparture, locale) });
    return (
      <div className="v2-offer-action" role="status" data-testid="booking-done">
        <p className="v2-offer-action-amount">{heading}</p>
        <p className="v2-body">{text}</p>
        <Link href="/v2/services#gebucht" className="v2-link v2-text">
          <span>{t("toOverview")}</span>
          <V2Arrow />
        </Link>
      </div>
    );
  }

  if (booking.state !== "open") {
    return (
      <div className="v2-offer-action" data-testid="booking-state">
        <p className="v2-body">{t(`state.${booking.state}`)}</p>
        <Link href="/v2/services#gebucht" className="v2-link v2-text">
          <span>{t("toOverview")}</span>
          <V2Arrow />
        </Link>
      </div>
    );
  }

  if (total === null) {
    return (
      <div className="v2-offer-action">
        <p className="v2-body v2-muted">{t("noPrice")}</p>
      </div>
    );
  }

  const request = booking.kind === "service" && booking.fulfillment === "request";
  const needsPlates = booking.kind === "service" && booking.requiresPlate;
  const platesComplete =
    !needsPlates || plates.slice(0, count).every((plate) => plate.trim().length > 0);

  const resize = (next: number) => {
    setCount(next);
    setPlates((current) => Array.from({ length: next }, (_, i) => current[i] ?? ""));
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      let outcome: BookingOutcome;
      if (booking.kind === "extension") {
        outcome = await extendStayAction({
          idempotencyKey,
          currentDeparture: booking.currentDeparture,
          expectedPrice: { amountCents: booking.totalCents, currency },
        });
      } else if (request) {
        outcome = await requestExtraAction({
          idempotencyKey,
          serviceId: booking.serviceId,
          quantity: count,
        });
      } else {
        outcome = await bookExtraAction({
          idempotencyKey,
          serviceId: booking.serviceId,
          count,
          ...(needsPlates ? { vehiclePlates: plates.slice(0, count).map((p) => p.trim()) } : {}),
          expectedPrice: { amountCents: total, currency },
        });
      }
      if (outcome.kind === "error") {
        if (outcome.reason === "price_changed") {
          // A new price needs a new, conscious confirmation.
          setIdempotencyKey(crypto.randomUUID());
          router.refresh();
        }
        setError(t(`errors.${outcome.reason === "invalid" ? "unavailable" : outcome.reason}`));
        return;
      }
      setDone(outcome);
      router.refresh();
    });
  };

  return (
    <form
      className="v2-offer-action"
      data-testid="booking-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <dl className="v2-rows">
        {booking.kind === "service" && booking.serviceDates.length > 0 && (
          <div className="v2-row">
            <dt>{booking.serviceDates.length > 1 ? t("dates") : t("date")}</dt>
            <dd className="v2-text">
              {period(booking.serviceDates, locale)}
              {booking.nights > 1 && (
                <span className="v2-muted"> · {t("nights", { count: booking.nights })}</span>
              )}
            </dd>
          </div>
        )}
        {booking.kind === "extension" && (
          <>
            <div className="v2-row">
              <dt>{t("extension.currentDeparture")}</dt>
              <dd className="v2-text">{day(booking.currentDeparture, locale)}</dd>
            </div>
            <div className="v2-row">
              <dt>{t("extension.newDeparture")}</dt>
              <dd className="v2-text">{day(booking.newDeparture, locale)}</dd>
            </div>
            {booking.accommodationCents !== null && (
              <div className="v2-row">
                <dt>{t("extension.accommodation")}</dt>
                <dd className="v2-text">{money(booking.accommodationCents, currency, locale)}</dd>
              </div>
            )}
            {booking.extras.map((extra) => (
              <div className="v2-row" key={extra.name}>
                <dt>{extra.name}</dt>
                <dd className="v2-text">
                  {extra.cents === null ? "–" : money(extra.cents, currency, locale)}
                </dd>
              </div>
            ))}
            {booking.cityTaxCents !== null && (
              <div className="v2-row">
                <dt>{t("extension.cityTax")}</dt>
                <dd className="v2-text">{money(booking.cityTaxCents, currency, locale)}</dd>
              </div>
            )}
          </>
        )}
      </dl>

      {booking.kind === "service" && booking.quantity && (
        <div className="v2-offer-action-price" style={{ paddingTop: 6 }}>
          <span className="v2-field-label" id="booking-quantity">
            {t("quantity")}
          </span>
          <span
            role="group"
            aria-labelledby="booking-quantity"
            style={{ display: "flex", alignItems: "center", gap: 18 }}
          >
            <button
              type="button"
              className="v2-icon-button"
              aria-label={t("decrease")}
              disabled={count <= 1 || pending}
              onClick={() => {
                resize(count - 1);
              }}
            >
              −
            </button>
            <output
              aria-live="polite"
              className="v2-offer-action-amount"
              style={{ minWidth: 24, textAlign: "center" }}
            >
              {count}
            </output>
            <button
              type="button"
              className="v2-icon-button"
              aria-label={t("increase")}
              disabled={(booking.maxQuantity !== null && count >= booking.maxQuantity) || pending}
              onClick={() => {
                resize(count + 1);
              }}
            >
              +
            </button>
          </span>
        </div>
      )}

      {needsPlates &&
        Array.from({ length: count }, (_, i) => (
          <div className="v2-field" key={i}>
            <label htmlFor={`plate-${i}`}>{t("plate", { number: i + 1 })}</label>
            <input
              id={`plate-${i}`}
              name={`plate-${i}`}
              className="v2-input"
              value={plates[i] ?? ""}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="characters"
              required
              aria-describedby="plate-hint"
              onChange={(event) => {
                const next = [...plates];
                next[i] = event.target.value;
                setPlates(next);
              }}
            />
          </div>
        ))}
      {needsPlates && (
        <p id="plate-hint" className="v2-small v2-muted">
          {t("plateHint")}
        </p>
      )}

      <div className="v2-offer-action-price">
        <span className="v2-field-label">{request ? t("requestTotal") : t("total")}</span>
        <span className="v2-offer-action-amount" data-testid="booking-total">
          {total === 0 ? priceText("free") : money(total, currency, locale)}
        </span>
      </div>
      {request ? (
        <p className="v2-small v2-muted" data-testid="booking-note">
          {t("requestNote")}
        </p>
      ) : (
        <p className="v2-small v2-muted" data-testid="booking-note">
          {t("instantNote")} {t("totalNote")}
        </p>
      )}

      {error && (
        <p className="v2-notice" role="alert" data-testid="booking-error">
          {error}
        </p>
      )}

      <button type="submit" className="v2-button" disabled={pending || !platesComplete}>
        <span>
          {pending
            ? t("sending")
            : booking.kind === "extension"
              ? t("submitExtension")
              : request
                ? t("submitRequest")
                : t("submitInstant")}
        </span>
        <V2Arrow />
      </button>
    </form>
  );
}
