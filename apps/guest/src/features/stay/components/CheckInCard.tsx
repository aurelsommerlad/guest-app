import { Icon, StatusList, buttonStyles } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type CheckInCardView } from "../model";

/**
 * Online check-in on STAY: not started → start, in progress → continue with progress,
 * completed → quiet confirmation. Shows only states that are true.
 */
export async function CheckInCard({ card }: { card: CheckInCardView }) {
  const t = await getTranslations("stay.checkInCard");
  const stateLabels = { done: t("done"), open: t("open") };
  const eyebrow = (
    <div className="flex items-center gap-3">
      <Icon name={card.state === "completed" ? "circle-check" : "id-card"} size="md" />
      <span className="type-eyebrow">{t("eyebrow")}</span>
    </div>
  );

  if (card.state === "completed") {
    return (
      <section
        aria-labelledby="check-in-card-title"
        className="flex flex-col gap-4 rounded-card bg-surface-sage p-4 text-text xs:p-5"
      >
        {eyebrow}
        <div className="flex flex-col gap-1.5">
          <h2 id="check-in-card-title" className="type-title">
            {t("completedTitle")}
          </h2>
          <p className="type-small text-text-muted">{t("completedBody")}</p>
        </div>
        <StatusList
          stateLabels={stateLabels}
          items={[
            ...card.steps.map((step) => ({
              id: step,
              label: t(`steps.${step}`),
              state: "done" as const,
            })),
            ...(card.guestRegistration
              ? [
                  {
                    id: "guest-registration",
                    label:
                      card.guestRegistration === "submitted"
                        ? t("guestRegistrationSubmitted")
                        : t("guestRegistrationPending"),
                    state:
                      card.guestRegistration === "submitted"
                        ? ("done" as const)
                        : ("open" as const),
                  },
                ]
              : []),
          ]}
        />
      </section>
    );
  }

  const inProgress = card.state === "in-progress";
  const steps = inProgress ? card.steps : card.steps.map((id) => ({ id, done: false }));
  const title = inProgress
    ? card.stepsRemaining <= 1
      ? t("almostDoneTitle")
      : t("inProgressTitle")
    : t("notStartedTitle");

  return (
    <section
      aria-labelledby="check-in-card-title"
      className="flex flex-col gap-4 rounded-card bg-surface-sage p-4 text-text xs:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {eyebrow}
        {inProgress && (
          <span className="type-caption rounded-full border border-border bg-surface-raised px-3 py-1 text-text">
            {t("openSteps", { count: card.stepsRemaining })}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 id="check-in-card-title" className="type-title-lg">
          {title}
        </h2>
        <p className="type-small text-text-muted">
          {inProgress ? t("inProgressBody") : t("notStartedBody")}
        </p>
      </div>
      <StatusList
        layout="row"
        stateLabels={stateLabels}
        items={steps.map((step) => ({
          id: step.id,
          label: t(`steps.${step.id}`),
          state: step.done ? "done" : "open",
        }))}
      />
      {inProgress ? (
        <div className="flex items-center gap-3">
          <span className="type-caption shrink-0 text-text-muted">{t("progress")}</span>
          <span aria-hidden className="flex flex-1 gap-1.5">
            {steps.map((step) => (
              <span
                key={step.id}
                className={"h-1.5 flex-1 rounded-full " + (step.done ? "bg-success" : "bg-border")}
              />
            ))}
          </span>
        </div>
      ) : (
        <p className="type-caption flex items-center gap-2 text-text-muted">
          <Icon name="clock" size="sm" />
          {t("duration")}
        </p>
      )}
      <Link href={card.href} className={buttonStyles("primary", "w-full")}>
        {inProgress ? t("continue") : t("start")}
        <Icon name="arrow-right" size="sm" />
      </Link>
    </section>
  );
}
