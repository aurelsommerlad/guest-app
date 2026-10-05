import { Container, Heading, Icon, Stack, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../i18n/navigation";

/** Minimal page for sections that are not built yet, so navigation never leads to a 404. */
export async function SectionPlaceholder({ title }: { title: string }) {
  const t = await getTranslations("placeholder");
  return (
    <div className="safe-top">
      <Container as="main" width="content" className="pt-16 lg:pt-24">
        <Stack gap={4}>
          <Text variant="eyebrow" tone="muted">
            {t("eyebrow")}
          </Text>
          <Heading level={1}>{title}</Heading>
          <Text variant="lead" tone="muted" className="max-w-64 text-balance">
            {t("body")}
          </Text>
          <Link
            href="/stay"
            className="type-small mt-4 inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-action underline-offset-4 hover:underline"
          >
            <Icon name="arrow-left" size="sm" />
            {t("back")}
          </Link>
        </Stack>
      </Container>
    </div>
  );
}
