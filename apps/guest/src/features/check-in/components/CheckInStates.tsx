import { Heading, Stack, Text, buttonStyles } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";

export async function CheckInDone() {
  const t = await getTranslations("checkIn.done");
  return (
    <Stack gap={6}>
      <Stack gap={3}>
        <Heading level={1}>{t("title")}</Heading>
        <Text variant="lead" tone="muted" className="text-balance">
          {t("body")}
        </Text>
      </Stack>
      <Link href="/stay" className={buttonStyles("primary", "self-start")}>
        {t("back")}
      </Link>
    </Stack>
  );
}

export async function CheckInUnavailable() {
  const t = await getTranslations("checkIn");
  return (
    <Stack gap={6}>
      <Stack gap={3}>
        <Heading level={1}>{t("unavailable.title")}</Heading>
        <Text variant="lead" tone="muted" className="text-balance">
          {t("unavailable.body")}
        </Text>
      </Stack>
      <Link href="/stay" className={buttonStyles("secondary", "self-start")}>
        {t("back")}
      </Link>
    </Stack>
  );
}
