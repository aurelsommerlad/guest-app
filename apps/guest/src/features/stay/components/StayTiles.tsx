import { Icon, InfoTile } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type AccentTileView, type StartTileView } from "../model";

/** Keeps the arrow attached to the last word, so it never wraps onto a line of its own. */
function WithArrow({ text }: { text: string }) {
  const cut = text.lastIndexOf(" ");
  const head = cut === -1 ? "" : text.slice(0, cut + 1);
  const last = cut === -1 ? text : text.slice(cut + 1);
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {last}
        <Icon name="arrow-right" size="sm" className="ml-2 inline-block align-middle" />
      </span>
    </>
  );
}

/** Four compact segments – one per check-in step. Decorative: the meta line says it in words. */
function Progress({ steps }: { steps: readonly { done: boolean }[] }) {
  return (
    <span aria-hidden className="flex gap-1.5">
      {steps.map((step, index) => (
        <span
          key={index}
          className={"h-1 flex-1 rounded-full " + (step.done ? "bg-text-inverse" : "bg-text-inverse/30")}
        />
      ))}
    </span>
  );
}

/**
 * The two tiles under the greeting (original STAY design): left the stay or the next time,
 * right – in sage – whatever matters now (check-in, payment, access, apartment, check-out).
 */
export async function StayTiles({
  start,
  accent,
}: {
  start: StartTileView;
  accent: AccentTileView;
}) {
  const t = await getTranslations("stay");

  const startTile =
    start.kind === "stay" ? (
      <InfoTile
        icon="calendar"
        label={t("tiles.stay")}
        value={start.dates}
        valueStyle="statement"
        meta={start.title}
        href={start.href}
        linkLabel={t("summary.details")}
        linkComponent={Link}
      />
    ) : start.kind === "apartment" ? (
      <InfoTile
        icon="home"
        label={t("apartment")}
        value={start.name}
        meta={<WithArrow text={t("apartmentDetails")} />}
        href={start.href}
        linkLabel={t("apartmentDetailsContext", { name: start.name })}
        linkComponent={Link}
      />
    ) : (
      <InfoTile
        icon="calendar"
        label={
          start.which === "check-in"
            ? t("checkIn")
            : start.today
              ? t("checkOutToday")
              : t("checkOut")
        }
        value={<time dateTime={start.dateTime}>{start.time}</time>}
        meta={<time dateTime={start.dateTime}>{start.date}</time>}
      />
    );

  const accentTile =
    accent.kind === "check-in" ? (
      <InfoTile
        icon="id-card"
        tone="accent"
        label={t("onlineCheckIn")}
        value={
          accent.state === "not-started"
            ? t("tiles.notStarted")
            : accent.stepsRemaining <= 1
              ? t("tiles.almostDone")
              : t("tiles.inProgress")
        }
        valueStyle="statement"
        meta={t("checkInCard.openSteps", { count: accent.stepsRemaining })}
        // Progress only once there is some – an empty bar says nothing.
        footer={accent.state === "in-progress" ? <Progress steps={accent.steps} /> : undefined}
        href={accent.href}
        linkLabel={
          accent.state === "not-started" ? t("checkInCard.start") : t("checkInCard.continue")
        }
        linkComponent={Link}
      />
    ) : accent.kind === "check-in-completed" ? (
      <InfoTile
        icon="circle-check"
        tone="accent"
        label={t("tiles.beforeArrival")}
        value={t("tiles.checkInDone")}
        valueStyle="statement"
        meta={t("tiles.seeYouSoon")}
      />
    ) : accent.kind === "payment" ? (
      <InfoTile
        icon="credit-card"
        tone="accent"
        label={t("tiles.payment")}
        value={t("tiles.paymentOpen")}
        valueStyle="statement"
        meta={<WithArrow text={t("tiles.paymentAction")} />}
        href={accent.href}
        linkLabel={t("tiles.paymentAction")}
        linkComponent={Link}
      />
    ) : accent.kind === "access" ? (
      <InfoTile
        icon="key"
        tone="accent"
        label={t("tiles.access")}
        value={t("tiles.welcome")}
        valueStyle="statement"
        meta={<WithArrow text={t("tiles.accessAction")} />}
        href={accent.href}
        linkLabel={t("tiles.accessAction")}
      />
    ) : accent.kind === "check-out" ? (
      <InfoTile
        icon="calendar"
        tone="accent"
        label={t("checkOut")}
        value={<time dateTime={accent.dateTime}>{accent.time}</time>}
        meta={t("tiles.seeYouSoon")}
      />
    ) : (
      <InfoTile
        icon="home"
        tone="accent"
        label={t("apartment")}
        value={accent.name}
        meta={<WithArrow text={t("apartmentDetails")} />}
        href={accent.href}
        linkLabel={t("apartmentDetailsContext", { name: accent.name })}
        linkComponent={Link}
      />
    );

  return (
    <div>
      <dl aria-label={t("infoHeading")} className="grid grid-cols-2 gap-2">
        {startTile}
        {accentTile}
      </dl>
      {accent.kind === "check-in-completed" && accent.occupancyChanged && (
        <p className="type-small mt-3 flex items-start gap-2 text-text">
          <Icon name="info" size="sm" className="mt-0.5 shrink-0" />
          <span>{t("checkInCard.occupancyChanged")}</span>
        </p>
      )}
    </div>
  );
}
