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
          className={"h-1 flex-1 rounded-full " + (step.done ? "bg-on-accent" : "bg-on-accent/20")}
        />
      ))}
    </span>
  );
}

/**
 * The two tiles under the greeting (original STAY design): left the stay or the next time,
 * right – in sage – the open online check-in, its completion, or the apartment.
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
        footer={<Progress steps={accent.steps} />}
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
        label={t("onlineCheckIn")}
        value={t("tiles.completed")}
        valueStyle="statement"
        meta={
          accent.guestRegistration === "submitted"
            ? t("checkInCard.guestRegistrationSubmitted")
            : accent.guestRegistration === "pending"
              ? t("checkInCard.guestRegistrationPending")
              : t("tiles.completedMeta")
        }
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
