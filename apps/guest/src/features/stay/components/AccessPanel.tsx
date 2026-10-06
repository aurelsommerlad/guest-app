import { Icon, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayAccessView } from "../model";
import { AccessCodeReveal } from "./AccessCodeReveal";

/**
 * "Dein Zugang" – from the arrival day on. Provider-neutral: the guest sees the kind of
 * access (key box, PIN …) and instructions, never a provider or lock name. The code is
 * fetched only when the guest asks for it (AccessCodeReveal).
 */
export async function AccessPanel({ access }: { access: StayAccessView }) {
  const t = await getTranslations("stay.access");
  return (
    <section
      aria-labelledby="stay-access-heading"
      className="flex flex-col gap-3 rounded-card bg-surface p-4 text-text xs:p-5"
    >
      <h2 id="stay-access-heading" className="flex items-center gap-3">
        <Icon name="key" size="sm" />
        <span className="type-eyebrow">{t("heading")}</span>
      </h2>
      {access.kind === "available" && (
        <>
          <Text className="text-text">
            {t(`type.${access.credentialType}`)}
            {" · "}
            {t("validFrom", { time: access.validFrom.time, date: access.validFrom.date })}
          </Text>
          <AccessCodeReveal />
          {access.instructions && <Text tone="muted">{access.instructions}</Text>}
        </>
      )}
      {access.kind === "manual" && (
        <Text tone="muted">{access.instructions ?? t("manualDefault")}</Text>
      )}
      {access.kind === "registration-required" && (
        <Text tone="muted">
          {t("registrationRequired")}{" "}
          <Link href={access.href} className="text-action underline underline-offset-4">
            {t("registrationRequiredLink")}
          </Link>
        </Text>
      )}
      {access.kind === "not-yet-released" && (
        <Text tone="muted">{t("notYetReleased", { time: access.time, date: access.date })}</Text>
      )}
      {access.kind === "not-issued" && <Text tone="muted">{t("notIssued")}</Text>}
    </section>
  );
}
