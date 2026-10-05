import { Container, Heading, Stack, Text } from "@up/ui";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LoginForm } from "../../../features/guest-access/components/LoginForm";
import { loginAction } from "../../../features/guest-access/login-action";
import { routing } from "../../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "access.login",
  });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/** Fallback access: booking number + last name. No account, no password, no e-mail. */
export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const [t, tHeader] = await Promise.all([
    getTranslations("access.login"),
    getTranslations("header"),
  ]);

  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:pt-10">
        <header className="flex min-h-11 items-center">
          <p className="type-wordmark text-text">{tHeader("brand")}</p>
        </header>
        <main className="pt-12 pb-16 lg:pt-20">
          <Stack gap={4}>
            <Heading level={1}>{t("title")}</Heading>
            <Text variant="lead" tone="muted" className="max-w-80 text-balance">
              {t("lead")}
            </Text>
          </Stack>
          <div className="mt-10 max-w-reading">
            <LoginForm action={loginAction.bind(null, locale)} />
          </div>
        </main>
      </Container>
    </div>
  );
}
