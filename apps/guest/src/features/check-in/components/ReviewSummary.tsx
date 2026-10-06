import { type CheckInStep, type RegistrationField } from "@up/core";
import { Icon, SummaryCard, type SummaryGroup } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayJourney } from "../../journey/stay-journey";
import { type GuestStep, stepFields, stepPositions } from "../check-in-service";

type Props = {
  journey: StayJourney;
  steps: readonly CheckInStep[];
  countryName: (code: string) => string;
  formatDate: (isoDate: string) => string;
};

const DOCUMENT_FIELDS = new Set<RegistrationField>(["documentType", "documentNumber"]);

/** Everything entered as calm cards (Hauptgast · Mitreisende · Adresse · Ausweis), each editable. */
export async function ReviewSummary({ journey, steps, countryName, formatDate }: Props) {
  const t = await getTranslations("checkIn");
  const display = (field: RegistrationField, value: string) => {
    if (field === "nationality" || field === "country") return countryName(value);
    if (field === "birthDate") return formatDate(value);
    if (field === "documentType") {
      return t(`documentTypes.${value as "passport" | "id-card" | "other"}`);
    }
    return value;
  };
  const dataOf = (position: number) =>
    journey.registration?.guests.find((guest) => guest.position === position)?.data ?? {};
  const group = (
    step: GuestStep,
    position: number,
    filter: (field: RegistrationField) => boolean = () => true,
    title?: string,
  ): SummaryGroup => {
    const data = dataOf(position);
    return {
      id: `${step}-${String(position)}`,
      ...(title ? { title } : {}),
      items: stepFields(journey, step, position)
        .filter((field) => filter(field) && data[field])
        .map((field) => ({
          id: field,
          label: t(`fields.${field}`),
          value: display(field, data[field] ?? ""),
        })),
    };
  };
  const change = (step: GuestStep, name: string) => (
    <Link
      href={`/check-in/${step}`}
      className="type-small inline-flex min-h-11 items-center gap-1.5 text-action underline-offset-4 hover:underline"
    >
      <Icon name="pencil" size="sm" />
      {t("change")}
      <span className="sr-only"> – {name}</span>
    </Link>
  );

  const addressGroup = group("address", 0, (field) => !DOCUMENT_FIELDS.has(field));
  const documentGroup = group("address", 0, (field) => DOCUMENT_FIELDS.has(field));

  return (
    <div className="flex flex-col gap-3">
      <SummaryCard
        title={t("review.primary")}
        icon="user"
        action={change("primary", t("review.primary"))}
        groups={[group("primary", 0)]}
      />
      {steps.includes("companions") && (
        <SummaryCard
          title={t("review.companions")}
          icon="users"
          action={change("companions", t("review.companions"))}
          groups={stepPositions(journey, "companions").map((position) =>
            group("companions", position, undefined, t("companion", { number: position + 1 })),
          )}
        />
      )}
      {steps.includes("address") && addressGroup.items.length > 0 && (
        <SummaryCard
          title={t("review.address")}
          icon="map-pin"
          action={change("address", t("review.address"))}
          groups={[addressGroup]}
        />
      )}
      {steps.includes("address") && documentGroup.items.length > 0 && (
        <SummaryCard
          title={t("review.document")}
          icon="id-card"
          action={change("address", t("review.document"))}
          groups={[documentGroup]}
        />
      )}
    </div>
  );
}
