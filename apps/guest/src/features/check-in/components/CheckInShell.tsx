import { type CheckInStep } from "@up/core";
import { Container, Heading, Icon, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";
import { type ReactNode } from "react";

import { Link } from "../../../i18n/navigation";

type Props = {
  steps?: readonly CheckInStep[];
  current?: CheckInStep;
  children: ReactNode;
};

/** Frame of every check-in screen: back to STAY, title, step progress. Mobile-first. */
export async function CheckInShell({ steps, current, children }: Props) {
  const t = await getTranslations("checkIn");
  const index = steps && current ? steps.indexOf(current) : -1;
  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:pt-10">
        <header className="flex min-h-11 items-center">
          <Link
            href="/stay"
            className="type-small inline-flex min-h-11 items-center gap-2 text-text underline-offset-4 hover:underline"
          >
            <Icon name="arrow-left" size="sm" />
            {t("back")}
          </Link>
        </header>
        <main className="pt-6 pb-16 lg:pt-12">
          <p className="type-eyebrow text-text-muted">{t("title")}</p>
          {steps && current && index >= 0 && (
            <div className="mt-3 flex flex-col gap-3">
              <Heading level={1}>{t(`steps.${current}`)}</Heading>
              <div className="flex flex-col gap-2">
                <Text variant="small" tone="muted">
                  {t("progress", { current: index + 1, total: steps.length })}
                </Text>
                <ol aria-label={t("title")} className="flex gap-1.5">
                  {steps.map((step, position) => (
                    <li
                      key={step}
                      aria-current={step === current ? "step" : undefined}
                      className={
                        "h-1 flex-1 rounded-full " + (position <= index ? "bg-text" : "bg-border")
                      }
                    >
                      <span className="sr-only">{t(`steps.${step}`)}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <Text variant="lead" tone="muted" className="text-balance">
                {t(`intro.${current}`)}
              </Text>
            </div>
          )}
          <div className="mt-8">{children}</div>
        </main>
      </Container>
    </div>
  );
}
