import { type CheckInStep, type RegistrationField } from "@up/core";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type GuestStep, stepFields, stepPositions } from "../check-in-service";
import { type StayJourney } from "../../journey/stay-journey";

type Props = {
  journey: StayJourney;
  steps: readonly CheckInStep[];
  countryName: (code: string) => string;
  formatDate: (isoDate: string) => string;
};

const GUEST_STEPS: readonly GuestStep[] = ["primary", "companions", "address"];

/** Everything entered, grouped by step, each with a "Ändern" link. Text only, no HTML. */
export async function ReviewSummary({ journey, steps, countryName, formatDate }: Props) {
  const t = await getTranslations("checkIn");
  const display = (field: RegistrationField, value: string) => {
    if (field === "nationality" || field === "country") return countryName(value);
    if (field === "birthDate") return formatDate(value);
    if (field === "documentType")
      return t(`documentTypes.${value as "passport" | "id-card" | "other"}`);
    return value;
  };
  return (
    <div className="flex flex-col gap-6">
      {GUEST_STEPS.filter((step) => steps.includes(step)).map((step) => (
        <section key={step} className="rounded-card bg-surface p-4 text-text xs:p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="type-eyebrow">{t(`steps.${step}`)}</h2>
            <Link
              href={`/check-in/${step}`}
              className="type-small text-action underline-offset-4 hover:underline"
            >
              {t("change")}
              <span className="sr-only"> – {t(`steps.${step}`)}</span>
            </Link>
          </div>
          {stepPositions(journey, step).map((position) => {
            const data =
              journey.registration?.guests.find((guest) => guest.position === position)?.data ?? {};
            const fields = stepFields(journey, step, position).filter((field) => data[field]);
            return (
              <div key={position} className="mt-4">
                {step === "companions" && (
                  <h3 className="type-small mb-2 text-text-muted">
                    {t("companion", { number: position + 1 })}
                  </h3>
                )}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 xs:grid-cols-2">
                  {fields.map((field) => (
                    <div key={field} className="min-w-0">
                      <dt className="type-small text-text-muted">{t(`fields.${field}`)}</dt>
                      <dd className="type-body break-words">{display(field, data[field] ?? "")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
