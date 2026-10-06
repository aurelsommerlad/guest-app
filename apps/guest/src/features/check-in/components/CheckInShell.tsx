import { type CheckInStep, type StepState } from "@up/core";
import { Container, Heading, Icon, ProgressSteps, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";
import { type ReactNode } from "react";

import { Link } from "../../../i18n/navigation";

type Props = {
  /** Visible steps with their saved state (skipped steps already removed). */
  steps?: readonly { id: CheckInStep; state: StepState }[];
  current?: CheckInStep;
  /** Done page: every step is shown as completed. */
  allComplete?: boolean;
  /** Where the back arrow leads (previous step, else STAY). */
  backHref?: string;
  /** Page title and intro; omitted on the done/unavailable screens (they bring their own). */
  title?: string;
  intro?: string;
  children: ReactNode;
};

/**
 * Frame of every check-in screen: back arrow · "Online-Check-in" · named progress steps,
 * then the step title. Mobile-first; on desktop a comfortable reading width.
 */
export async function CheckInShell({
  steps,
  current,
  allComplete = false,
  backHref = "/stay",
  title,
  intro,
  children,
}: Props) {
  const t = await getTranslations("checkIn");
  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:pt-6">
        <header className="flex min-h-14 items-center gap-2">
          <Link
            href={backHref}
            aria-label={backHref === "/stay" ? t("back") : t("backTo")}
            className="-ml-2 inline-flex size-11 items-center justify-center rounded-full text-text hover:bg-surface"
          >
            <Icon name="arrow-left" size="md" />
          </Link>
          <p className="type-title flex-1 text-center text-text">{t("title")}</p>
          <span aria-hidden className="size-11" />
        </header>
        {steps && steps.length > 0 && (
          <ProgressSteps
            className="mt-3"
            label={t("progressLabel")}
            stateLabels={{ complete: t("stepState.complete"), current: t("stepState.current") }}
            steps={steps.map((step) => ({
              id: step.id,
              label: t(`stepsShort.${step.id}`),
              state: allComplete
                ? "complete"
                : step.id === current
                  ? "current"
                  : step.state === "complete"
                    ? "complete"
                    : "upcoming",
            }))}
          />
        )}
        <main className="pt-8 pb-10 lg:pt-10">
          {title && (
            <div className="mb-6 flex flex-col gap-2">
              <Heading level={1}>{title}</Heading>
              {intro && (
                <Text variant="lead" tone="muted" className="text-balance">
                  {intro}
                </Text>
              )}
            </div>
          )}
          {children}
        </main>
      </Container>
    </div>
  );
}
