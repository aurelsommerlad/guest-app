import { type CheckInStep, type RegistrationField } from "@up/core";
import { Icon, SummaryCard, type SummaryGroup } from "@up/ui";
import { formatPhone } from "@up/core/phone";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayJourney } from "../../journey/stay-journey";
import {
  effectiveStepFields,
  type GuestStep,
  stepPositions,
  storedAddressSource,
} from "../check-in-service";
import { billingRows, reviewStatusRows } from "../review-status";

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
    if (field === "phone") return formatPhone(value);
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
    const source = storedAddressSource(journey, position);
    const items: { id: string; label: string; value: string }[] = effectiveStepFields(
      journey,
      step,
      position,
      source,
    )
      .filter((field) => filter(field) && data[field])
      .map((field) => ({
        id: field,
        label: t(`fields.${field}`),
        value: display(field, data[field] ?? ""),
      }));
    if (source === "same-as-primary") {
      items.push({
        id: "sharedAddress",
        label: t("review.sharedAddress"),
        value: t("review.sharedAddressValue"),
      });
    }
    return { id: `${step}-${String(position)}`, ...(title ? { title } : {}), items };
  };
  const change = (step: CheckInStep, name: string) => (
    <Link
      href={`/check-in/${step}`}
      className="type-small inline-flex min-h-11 items-center gap-1.5 text-action underline-offset-4 hover:underline"
    >
      <Icon name="pencil" size="sm" />
      {t("change")}
      <span className="sr-only"> – {name}</span>
    </Link>
  );

  const companions = stepPositions(journey, "guests").filter((position) => position > 0);
  const addressGroup = group("address", 0, (field) => !DOCUMENT_FIELDS.has(field));
  const documentGroup = group("address", 0, (field) => DOCUMENT_FIELDS.has(field));
  const company = billingRows(journey.registration?.billing, countryName);
  const status = reviewStatusRows(journey);

  return (
    <div className="flex flex-col gap-3">
      <SummaryCard
        title={t("review.primary")}
        icon="user"
        action={change("guests", t("review.primary"))}
        groups={[group("guests", 0)]}
      />
      {companions.length > 0 && (
        <SummaryCard
          title={t("review.companions")}
          icon="users"
          action={change("guests", t("review.companions"))}
          groups={companions.map((position) =>
            group("guests", position, undefined, t("companion", { number: position + 1 })),
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
      {steps.includes("billing") && (
        <SummaryCard
          title={t("review.billing")}
          icon="file-text"
          action={change("billing", t("review.billing"))}
          groups={[
            {
              id: "billing",
              items:
                company.length > 0
                  ? company.map((row) => ({
                      id: row.id,
                      label: t(`billing.fields.${row.id as "companyName"}`),
                      value: row.value,
                    }))
                  : [
                      {
                        id: "billingKind",
                        label: t("billing.choiceLabel"),
                        value: t("review.billingPrivate"),
                      },
                    ],
            },
          ]}
        />
      )}
      {status.length > 0 && (
        <SummaryCard
          title={t("review.status")}
          icon="circle-check"
          groups={[
            {
              id: "status",
              items: status.map((row) => ({
                id: row.id,
                label: t(`status.labels.${row.id}`),
                value: t(`status.values.${row.value}` as "status.values.data.complete"),
              })),
            },
          ]}
        />
      )}
    </div>
  );
}
