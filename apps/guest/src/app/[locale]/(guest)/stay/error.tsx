"use client";

import { Button, Container, Heading, Stack, Text } from "@up/ui";
import { useTranslations } from "next-intl";

/**
 * Shown only when the stay cannot be loaded (e.g. PMS unavailable). Calm and
 * without technical details – those are in the server logs (error.digest).
 */
export default function StayError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("stayError");
  return (
    <div className="safe-top">
      <Container width="content" className="pt-16 md:max-w-reading lg:max-w-content lg:pt-24">
        <main>
          <Stack gap={4}>
            <Heading level={1}>{t("title")}</Heading>
            <Text variant="lead" tone="muted" className="max-w-72 text-balance">
              {t("body")}
            </Text>
            <div className="mt-4">
              <Button variant="secondary" onClick={retry}>
                {t("retry")}
              </Button>
            </div>
          </Stack>
        </main>
      </Container>
    </div>
  );
}
