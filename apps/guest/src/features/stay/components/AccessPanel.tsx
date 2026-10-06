import { Icon, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayAccessView, type StayViewModel } from "../model";
import { AccessCodeReveal } from "./AccessCodeReveal";

type Props =
  | { access: StayAccessView; preview?: undefined }
  | { access?: undefined; preview: NonNullable<StayViewModel["accessPreview"]> };

/**
 * "Dein Zugang" – before arrival only when it becomes available; from the arrival day on
 * the access itself. Provider-neutral: the guest sees the kind of access (key box, PIN …)
 * and instructions, never a provider or lock name. The code is fetched only on request.
 */
export async function AccessPanel({ access, preview }: Props) {
  const t = await getTranslations("stay.access");
  const locked =
    preview !== undefined ||
    access.kind === "not-yet-released" ||
    access.kind === "registration-required" ||
    access.kind === "not-issued";
  return (
    <section
      aria-labelledby="stay-access-heading"
      className="flex flex-col gap-4 rounded-card bg-surface p-4 text-text xs:p-5"
    >
      <h2 id="stay-access-heading" className="flex items-center gap-3">
        <Icon name={locked ? "lock" : "key"} size="md" />
        <span className="type-eyebrow">{t("heading")}</span>
      </h2>
      {preview && (
        <Text variant="small" tone="muted">
          {preview.withTime
            ? t("previewWithTime", { time: preview.time, date: preview.date })
            : t("previewDate", { date: preview.date })}
        </Text>
      )}
      {access?.kind === "available" && (
        <>
          <div className="flex flex-col gap-1">
            <p className="type-title">{t(`type.${access.credentialType}`)}</p>
            <Text variant="small" tone="muted">
              {t("validFrom", { time: access.validFrom.time, date: access.validFrom.date })}
            </Text>
          </div>
          <AccessCodeReveal />
          {access.instructions && (
            <p className="type-small flex gap-2.5 border-t border-border pt-4 text-text-muted">
              <Icon name="info" size="sm" className="mt-0.5 shrink-0 text-text" />
              <span>{access.instructions}</span>
            </p>
          )}
        </>
      )}
      {access?.kind === "manual" && (
        <Text variant="small" tone="muted">
          {access.instructions ?? t("manualDefault")}
        </Text>
      )}
      {access?.kind === "registration-required" && (
        <Text variant="small" tone="muted">
          {t("registrationRequired")}{" "}
          <Link href={access.href} className="text-action underline underline-offset-4">
            {t("registrationRequiredLink")}
          </Link>
        </Text>
      )}
      {access?.kind === "not-yet-released" && (
        <Text variant="small" tone="muted">
          {t("notYetReleased", { time: access.time, date: access.date })}
        </Text>
      )}
      {access?.kind === "not-issued" && (
        <Text variant="small" tone="muted">
          {t("notIssued")}
        </Text>
      )}
    </section>
  );
}
