import { type CheckInStep, type StepState } from "@up/core";
import { getTranslations } from "next-intl/server";
import { type ReactNode } from "react";

import { Link } from "../../i18n/navigation";
import { V2Arrow } from "../components/glyphs";

/**
 * Frame of every V2 check-in screen: back link, "SCHRITT 2 VON 4", hairline progress,
 * a large light title and the intro – then the step's content.
 */
export async function V2CheckInShell({
  steps,
  current,
  allComplete = false,
  backHref = "/v2",
  title,
  intro,
  children,
}: {
  steps?: readonly { id: CheckInStep; state: StepState }[];
  current?: CheckInStep;
  allComplete?: boolean;
  backHref?: string;
  title?: string;
  intro?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("checkIn");
  const v2 = await getTranslations("v2.checkIn");
  const index = current && steps ? steps.findIndex((step) => step.id === current) : -1;
  return (
    <div className="v2-page">
      <header className="v2-steps-head v2-margin">
        <Link href={backHref} className="v2-back">
          <V2Arrow />
          <span>{v2("back")}</span>
        </Link>
        <span className="v2-eyebrow v2-muted">{v2("eyebrow")}</span>
      </header>
      <main className="v2-margin">
        {steps && steps.length > 0 && (
          <div className="v2-stack v2-stack-4" style={{ paddingTop: 28 }}>
            {index >= 0 && (
              <p className="v2-eyebrow">
                {v2("step", { current: index + 1, total: steps.length })}
                <span className="v2-sr-only">
                  : {t(`stepsShort.${steps[index]?.id ?? "trip"}`)}
                </span>
              </p>
            )}
            <ol className="v2-progress" aria-label={t("progressLabel")}>
              {steps.map((step, position) => {
                const state = allComplete
                  ? "done"
                  : step.id === current
                    ? "current"
                    : step.state === "complete"
                      ? "done"
                      : "open";
                return (
                  <li key={step.id} data-state={state}>
                    <span className="v2-sr-only">
                      {position + 1}. {t(`stepsShort.${step.id}`)}
                      {state === "done"
                        ? ` – ${t("stepState.complete")}`
                        : state === "current"
                          ? ` – ${t("stepState.current")}`
                          : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {title && (
          <div className="v2-stack" style={{ paddingTop: 34, paddingBottom: 30 }}>
            <h1 className="v2-display">{title}</h1>
            {intro && (
              <p className="v2-lead v2-muted" style={{ marginTop: 14 }}>
                {intro}
              </p>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
