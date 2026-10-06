import { Icon } from "../icons/Icon";
import { cx } from "../lib/cx";

export type ProgressStepState = "complete" | "current" | "upcoming";

export type ProgressStep = { id: string; label: string; state: ProgressStepState };

export type ProgressStepsProps = {
  steps: readonly ProgressStep[];
  /** Accessible name of the list, e.g. "Fortschritt Online-Check-in". */
  label: string;
  /** Screen-reader suffixes, e.g. { complete: "erledigt", current: "aktueller Schritt" }. */
  stateLabels: Record<Exclude<ProgressStepState, "upcoming">, string>;
  className?: string;
};

/**
 * Named step indicator: dots joined by a line, label below. Done steps carry a check,
 * the current one is a filled dark-sage dot. On compact phones (< 360 px) only the
 * current step keeps its visible label. Labels must be short (one word); they never wrap.
 */
export function ProgressSteps({ steps, label, stateLabels, className }: ProgressStepsProps) {
  return (
    <ol aria-label={label} className={cx("flex w-full", className)}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.state === "current" ? "step" : undefined}
          className="relative flex min-w-0 flex-1 flex-col items-center gap-2"
        >
          {index > 0 && (
            <span
              aria-hidden
              className={cx(
                "absolute top-2.5 right-1/2 h-px w-full -translate-y-1/2",
                step.state === "upcoming" ? "bg-border" : "bg-success",
              )}
            />
          )}
          <span
            aria-hidden
            className={cx(
              "relative z-10 flex size-5 items-center justify-center rounded-full",
              step.state === "complete" && "bg-success text-on-success",
              step.state === "current" && "border-2 border-success bg-background",
              step.state === "upcoming" && "border border-text-muted bg-background",
            )}
          >
            {step.state === "complete" && <Icon name="check" size="xs" />}
            {step.state === "current" && <span className="size-2 rounded-full bg-success" />}
          </span>
          <span
            className={cx(
              "type-caption text-center whitespace-nowrap",
              step.state === "current" ? "text-text" : "text-text-muted",
              step.state !== "current" && "max-xs:sr-only",
            )}
          >
            {step.label}
            {step.state !== "upcoming" && (
              <span className="sr-only"> ({stateLabels[step.state]})</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
