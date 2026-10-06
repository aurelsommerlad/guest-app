import { Icon, type IconName, Stack, Text, buttonStyles } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";

export type NextStepItem = { id: string; icon: IconName; text: string };

/**
 * Success screen: calm check mark, thanks, and "Was passiert als Nächstes?" – only with
 * facts that are true for this stay (passed in by the page).
 */
export async function CheckInDone({
  firstName,
  next,
}: {
  firstName?: string;
  next: readonly NextStepItem[];
}) {
  const t = await getTranslations("checkIn.done");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <span
          aria-hidden
          className="flex size-20 items-center justify-center rounded-full bg-surface-sage text-success"
        >
          <Icon name="check" size="lg" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="type-title-lg text-text">{t("title")}</h1>
          <Text variant="lead" tone="muted" className="text-balance">
            {firstName ? t("body", { firstName }) : t("bodyWithoutName")}
          </Text>
        </div>
      </div>
      {next.length > 0 && (
        <section
          aria-labelledby="next-steps-heading"
          className="rounded-card bg-surface p-4 text-text xs:p-5"
        >
          <h2 id="next-steps-heading" className="type-title">
            {t("nextTitle")}
          </h2>
          <ul className="mt-4 flex flex-col gap-4">
            {next.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised"
                >
                  <Icon name={item.icon} size="sm" />
                </span>
                <span className="type-small pt-2 text-text">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href="/stay" className={buttonStyles("primary", "w-full sm:w-auto sm:self-center")}>
        {t("back")}
        <Icon name="arrow-right" size="sm" />
      </Link>
    </div>
  );
}

export async function CheckInUnavailable() {
  const t = await getTranslations("checkIn");
  return (
    <Stack gap={6}>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-5 text-text">
        <Icon name="info" size="lg" />
        <div className="flex flex-col gap-2">
          <h1 className="type-title-lg">{t("unavailable.title")}</h1>
          <Text tone="muted">{t("unavailable.body")}</Text>
        </div>
      </div>
      <Link href="/stay" className={buttonStyles("secondary", "w-full sm:w-auto sm:self-start")}>
        {t("back")}
      </Link>
    </Stack>
  );
}
