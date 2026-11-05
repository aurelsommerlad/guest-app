import { Icon, type IconName } from "@up/ui";
import { getTranslations } from "next-intl/server";
import { type ReactNode } from "react";

import { type StayViewModel } from "../../features/stay/model";
import { Link } from "../../i18n/navigation";

type Fact = { value: ReactNode; meta: string; href?: string; label: string };

/**
 * "Your stay at a glance" without tiles: left the stay (or the next time), a hairline,
 * right what matters now – derived from the same tile model as the current app
 * (selectTiles), so both designs always show the same, real state.
 */
export async function V2Facts({ stay }: { stay: StayViewModel }) {
  const t = await getTranslations("stay");
  const v2 = await getTranslations("v2");
  const { start, accent } = stay.tiles;

  const left: Fact =
    start.kind === "stay"
      ? {
          value: start.dates,
          meta: v2("apartmentName", { name: stay.unit.name }),
          href: "/v2/apartment",
          label: v2("facts.stay"),
        }
      : start.kind === "time"
        ? {
            value: <time dateTime={start.dateTime}>{start.time}</time>,
            meta: `${start.which === "check-in" ? t("checkIn") : start.today ? t("checkOutToday") : t("checkOut")} · ${start.date}`,
            href: "/v2/apartment",
            label: v2("facts.stay"),
          }
        : {
            value: start.name,
            meta: t("apartmentDetails"),
            href: "/v2/apartment",
            label: t("apartmentDetailsContext", { name: start.name }),
          };

  const [mark, right]: [IconName, Fact] =
    accent.kind === "check-in"
      ? [
          "id-card",
          {
            // Short statement + context, like "Check-in geschafft. / Bis bald!" in the reference.
            value:
              accent.state === "not-started"
                ? t("tiles.notStarted")
                : accent.stepsRemaining <= 1
                  ? t("tiles.almostDone")
                  : t("tiles.inProgress"),
            meta: t("onlineCheckIn"),
            href: "/v2/check-in",
            label:
              accent.state === "not-started" ? t("checkInCard.start") : t("checkInCard.continue"),
          },
        ]
      : accent.kind === "check-in-completed"
        ? [
            "check",
            {
              value: t("tiles.checkInDone"),
              meta: t("tiles.seeYouSoon"),
              label: t("tiles.checkInDone"),
            },
          ]
        : accent.kind === "payment"
          ? [
              "credit-card",
              {
                value: t("tiles.paymentOpen"),
                meta: t("tiles.paymentAction"),
                href: accent.href,
                label: t("tiles.paymentAction"),
              },
            ]
          : accent.kind === "access"
            ? [
                "key",
                {
                  value: t("tiles.welcome"),
                  meta: t("tiles.accessAction"),
                  href: "/v2/apartment#zugang",
                  label: t("tiles.accessAction"),
                },
              ]
            : accent.kind === "check-out"
              ? [
                  "log-out",
                  {
                    value: <time dateTime={accent.dateTime}>{accent.time}</time>,
                    meta: `${t("checkOut")} · ${t("tiles.seeYouSoon")}`,
                    label: t("checkOut"),
                  },
                ]
              : [
                  "home",
                  {
                    value: v2("apartmentName", { name: accent.name }),
                    meta: t("apartmentDetails"),
                    href: "/v2/apartment",
                    label: t("apartmentDetailsContext", { name: accent.name }),
                  },
                ];

  const body = (fact: Fact, icon: ReactNode, valueClass: string) => (
    <>
      {icon}
      <span className="v2-fact-value">
        <span className={valueClass}>{fact.value}</span>
        <span className="v2-small">{fact.meta}</span>
      </span>
    </>
  );
  const item = (fact: Fact, icon: ReactNode, valueClass: string) =>
    fact.href ? (
      <Link href={fact.href} className="v2-fact" aria-label={`${fact.label}: ${fact.meta}`}>
        {body(fact, icon, valueClass)}
      </Link>
    ) : (
      <div className="v2-fact">{body(fact, icon, valueClass)}</div>
    );

  return (
    <section aria-label={t("infoHeading")} className="v2-facts">
      {item(left, <Icon name="calendar" className="v2-fact-icon" />, "v2-statement")}
      <span aria-hidden className="v2-fact-rule" />
      {item(
        right,
        <span className="v2-mark">
          <Icon name={mark} />
        </span>,
        "v2-text",
      )}
    </section>
  );
}
