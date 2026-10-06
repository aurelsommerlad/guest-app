import { Icon, InfoTile } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayViewModel } from "../model";

// Inline (not flex) so the arrow stays attached to the last word when the text wraps.
const tileLink =
  "rounded-sm text-current underline-offset-4 hover:underline " +
  // Stretched link: the whole tile is the touch target.
  "after:absolute after:inset-0 after:rounded-card";
const tileLinkArrow = "ml-2 inline-block align-middle";

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
        <Icon name="arrow-right" size="sm" className={tileLinkArrow} />
      </span>
    </>
  );
}

/** The two information tiles: stay status (phase-dependent) and apartment. */
export async function StayInfoGrid({ status, unit }: Pick<StayViewModel, "status" | "unit">) {
  const t = await getTranslations("stay");

  const statusTile =
    status.kind === "online-check-in" ? (
      <InfoTile
        icon="check"
        label={t("onlineCheckIn")}
        value={status.started ? t("checkInContinue") : t("checkInCta")}
        valueStyle="text"
        meta={
          <Link href={status.href} className={tileLink}>
            <WithArrow text={t("stepsRemaining", { count: status.stepsRemaining })} />
          </Link>
        }
      />
    ) : (
      <InfoTile
        icon="calendar"
        label={
          status.kind === "check-in"
            ? t("checkIn")
            : status.today
              ? t("checkOutToday")
              : t("checkOut")
        }
        value={<time dateTime={status.dateTime}>{status.time}</time>}
        meta={<time dateTime={status.dateTime}>{status.date}</time>}
      />
    );

  return (
    <dl aria-label={t("infoHeading")} className="grid grid-cols-2 gap-2">
      {statusTile}
      <InfoTile
        icon="home"
        label={t("apartment")}
        value={unit.name}
        tone="accent"
        meta={
          <Link href={unit.href} className={tileLink}>
            <WithArrow text={t("apartmentDetails")} />
            <span className="sr-only"> {t("apartmentDetailsContext", { name: unit.name })}</span>
          </Link>
        }
      />
    </dl>
  );
}
