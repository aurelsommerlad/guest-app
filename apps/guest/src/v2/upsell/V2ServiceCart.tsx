"use client";

/**
 * Own services as one list with a shared selection – the Extras page's "choose several, book
 * once" in STAY's quiet rows. Each row keeps its link to the service page (details, single
 * booking, requests); instant services get a quantity choice in place, parking its plates. The
 * bar at the bottom shows the selection and books it with one confirmation; every line is
 * checked and booked on its own by the source, exactly as in Extras.
 */
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { bookCartAction } from "../../features/extras/actions";
import type { BookingOutcome, CartLineOutcome } from "../../features/extras/booking-service";
import type { ExtrasState } from "../../features/upsell/extras-merge";
import { Link } from "../../i18n/navigation";
import { V2Arrow } from "../components/glyphs";

export type CartRow = {
  id: string;
  href: string;
  title: string;
  teaser: string | null;
  image: { src: string } | null;
  priceText: string;
  state: ExtrasState;
  request: boolean;
  /** Instant services that can be selected here (open, priced). */
  selectable: {
    serviceId: string;
    unitCents: number;
    nights: number;
    currency: string;
    /** null = no limit from settings, capacity or availability. */
    maxQuantity: number | null;
    /** false = exactly one (one per reservation). */
    quantity: boolean;
    requiresPlate: boolean;
    existingPlate: string | null;
  } | null;
};

function money(cents: number, currency: string, locale: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

type Selection = Record<string, { count: number; plates: string[] }>;

export function V2ServiceCart({ rows }: { rows: CartRow[] }) {
  const t = useTranslations("services");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<Selection>({});
  // One key per confirmation of this selection: a repeated click never books a line twice.
  const [cartKey, setCartKey] = useState(() => crypto.randomUUID());
  const [results, setResults] = useState<CartLineOutcome[] | null>(null);
  // Titles as selected: after booking a row may no longer be selectable (booked, sold out).
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const chosen = rows.flatMap((row) => {
    const pick = selection[row.id];
    return row.selectable && pick && pick.count > 0 ? [{ row, s: row.selectable, ...pick }] : [];
  });
  const total = useMemo(
    () => chosen.reduce((sum, line) => sum + line.s.unitCents * line.s.nights * line.count, 0),
    [chosen],
  );
  const currency = chosen[0]?.s.currency ?? "EUR";
  const platesComplete = chosen.every(
    (line) => !line.s.requiresPlate || line.plates.slice(0, line.count).every((p) => p.trim()),
  );

  const setCount = (row: CartRow, next: number) => {
    const s = row.selectable;
    if (!s) return;
    const max = s.quantity ? s.maxQuantity : 1;
    const count = Math.max(0, max === null ? next : Math.min(next, max));
    setSelection((current) => {
      const before = current[row.id]?.plates ?? (s.existingPlate ? [s.existingPlate] : []);
      return {
        ...current,
        [row.id]: { count, plates: Array.from({ length: count }, (_, i) => before[i] ?? "") },
      };
    });
    setResults(null);
  };

  const reason = (outcome: BookingOutcome): string =>
    outcome.kind === "error"
      ? t(`booking.errors.${outcome.reason === "invalid" ? "unavailable" : outcome.reason}`)
      : "";

  const submit = () => {
    setError(null);
    setTitles(Object.fromEntries(chosen.map((line) => [line.s.serviceId, line.row.title])));
    startTransition(async () => {
      const result = await bookCartAction({
        cartKey,
        lines: chosen.map((line) => ({
          serviceId: line.s.serviceId,
          count: line.count,
          ...(line.s.requiresPlate ? { vehiclePlates: line.plates.slice(0, line.count) } : {}),
          expectedPrice: {
            amountCents: line.s.unitCents * line.s.nights * line.count,
            currency: line.s.currency,
          },
        })),
      });
      if (result.kind !== "cart") {
        setError(reason(result));
        return;
      }
      setResults(result.lines);
      // Booked lines leave the selection; refused ones stay for a corrected retry.
      const booked = new Set(
        result.lines.filter((l) => l.outcome.kind === "booked").map((l) => l.serviceId),
      );
      setSelection((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([id]) => !booked.has(rows.find((r) => r.id === id)?.selectable?.serviceId ?? ""),
          ),
        ),
      );
      setCartKey(crypto.randomUUID());
      router.refresh();
    });
  };

  const titleOf = (serviceId: string) => titles[serviceId] ?? serviceId;

  return (
    <>
      <ul className="v2-service-rows" data-testid="house-services">
        {rows.map((row) => {
          const pick = selection[row.id];
          const count = pick?.count ?? 0;
          const s = row.selectable;
          const max = s ? (s.quantity ? s.maxQuantity : 1) : 0;
          const action =
            row.state === "open"
              ? row.request
                ? t("list.request")
                : t("list.details")
              : t(`list.${row.state}`);
          return (
            <li
              key={row.id}
              className="v2-service-row"
              data-offer-id={row.id}
              data-state={row.state}
              data-image={row.image ? "yes" : "no"}
            >
              <Link href={row.href}>
                {row.image && (
                  <span className="v2-service-thumb" aria-hidden>
                    <Image
                      src={row.image.src}
                      alt=""
                      fill
                      sizes="88px"
                      style={{ objectFit: "cover" }}
                    />
                  </span>
                )}
                <span className="v2-service-text">
                  <span className="v2-service-title">{row.title}</span>
                  {row.teaser && (
                    <span className="v2-small v2-muted v2-service-teaser">{row.teaser}</span>
                  )}
                  <span className="v2-service-meta">
                    <span className="v2-service-price">{row.priceText}</span>
                    {row.request && row.state === "open" && (
                      <span className="v2-muted">{t("list.requestHint")}</span>
                    )}
                  </span>
                  <span
                    className={
                      row.state === "restricted" || row.state === "unavailable"
                        ? "v2-service-state is-blocked"
                        : "v2-service-state"
                    }
                  >
                    <span>{action}</span>
                    {row.state === "open" && <V2Arrow />}
                  </span>
                </span>
              </Link>
              {s && (
                <div className="v2-service-pick">
                  <span className="v2-field-label" id={`pick-${row.id}`}>
                    {t("cart.choose")}
                  </span>
                  <span role="group" aria-labelledby={`pick-${row.id}`} className="v2-stepper">
                    <button
                      type="button"
                      className="v2-icon-button"
                      aria-label={t("booking.decrease")}
                      disabled={count <= 0 || pending}
                      onClick={() => {
                        setCount(row, count - 1);
                      }}
                    >
                      −
                    </button>
                    <output aria-live="polite" data-testid={`count-${s.serviceId}`}>
                      {count}
                    </output>
                    <button
                      type="button"
                      className="v2-icon-button"
                      aria-label={t("cart.add", { service: row.title })}
                      disabled={(max !== null && count >= max) || pending}
                      onClick={() => {
                        setCount(row, count + 1);
                      }}
                    >
                      +
                    </button>
                  </span>
                  {s.requiresPlate &&
                    Array.from({ length: count }, (_, i) => (
                      <div className="v2-field v2-service-plate" key={i}>
                        <label htmlFor={`cart-plate-${row.id}-${String(i)}`}>
                          {t("booking.plate", { number: i + 1 })}
                        </label>
                        <input
                          id={`cart-plate-${row.id}-${String(i)}`}
                          className="v2-input"
                          value={pick?.plates[i] ?? ""}
                          maxLength={20}
                          autoComplete="off"
                          autoCapitalize="characters"
                          onChange={(event) => {
                            const plates = [...(pick?.plates ?? [])];
                            plates[i] = event.target.value;
                            setSelection((current) => ({
                              ...current,
                              [row.id]: { count, plates },
                            }));
                          }}
                        />
                      </div>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {results && (
        <div className="v2-cart-results" role="status" data-testid="cart-results">
          {results.map((line) => (
            <p key={line.serviceId} className="v2-small">
              <strong>{titleOf(line.serviceId)}</strong> –{" "}
              {line.outcome.kind === "booked" ? t("cart.booked") : reason(line.outcome)}
            </p>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="v2-cart-bar" data-testid="cart-bar">
          <div>
            <p className="v2-eyebrow">{t("cart.selection", { count: chosen.length })}</p>
            <p className="v2-cart-total" data-testid="cart-total">
              {money(total, currency, locale)}
            </p>
            <p className="v2-caption v2-muted">{t("booking.instantNote")}</p>
          </div>
          {error && (
            <p className="v2-notice" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="v2-button"
            disabled={pending || !platesComplete}
            onClick={submit}
          >
            <span>{pending ? t("booking.sending") : t("cart.submit")}</span>
            <V2Arrow />
          </button>
        </div>
      )}
    </>
  );
}
