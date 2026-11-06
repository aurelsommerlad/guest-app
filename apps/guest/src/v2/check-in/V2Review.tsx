import { type CheckInStep, type RegistrationField } from "@up/core";
import { formatPhone } from "@up/core/phone";
import { getTranslations } from "next-intl/server";

import {
  effectiveStepFields,
  type GuestStep,
  stepPositions,
  storedAddressSource,
} from "../../features/check-in/check-in-service";
import { billingRows, reviewStatusRows } from "../../features/check-in/review-status";
import { type StayJourney } from "../../features/journey/stay-journey";
import { Link } from "../../i18n/navigation";

const DOCUMENT_FIELDS = new Set<RegistrationField>(["documentType", "documentNumber"]);

/** Everything entered, as editorial sections with hairline rows – each editable. */
export async function V2Review({
  journey,
  steps,
  countryName,
  formatDate,
}: {
  journey: StayJourney;
  steps: readonly CheckInStep[];
  countryName: (code: string) => string;
  formatDate: (isoDate: string) => string;
}) {
  const t = await getTranslations("checkIn");
  const display = (field: RegistrationField, value: string) => {
    if (field === "nationality" || field === "country") return countryName(value);
    if (field === "birthDate") return formatDate(value);
    if (field === "phone") return formatPhone(value);
    if (field === "documentType")
      return t(`documentTypes.${value as "passport" | "id-card" | "other"}`);
    return value;
  };
  const dataOf = (position: number) =>
    journey.registration?.guests.find((guest) => guest.position === position)?.data ?? {};
  const rows = (
    step: GuestStep,
    position: number,
    filter: (field: RegistrationField) => boolean = () => true,
  ) => {
    const data = dataOf(position);
    const source = storedAddressSource(journey, position);
    const items: { field: string; label?: string; value: string }[] = effectiveStepFields(
      journey,
      step,
      position,
      source,
    )
      .filter((field) => filter(field) && data[field])
      .map((field) => ({ field, value: display(field, data[field] ?? "") }));
    if (source === "same-as-primary") {
      items.push({
        field: "sharedAddress",
        label: t("review.sharedAddress"),
        value: t("review.sharedAddressValue"),
      });
    }
    return items;
  };
  const section = (
    key: string,
    title: string,
    step: CheckInStep,
    items: { field: string; label?: string; value: string }[],
  ) =>
    items.length > 0 && (
      <section key={key} className="v2-stack" style={{ marginTop: 36 }}>
        <div className="v2-section-head">
          <h2 className="v2-eyebrow">{title}</h2>
          <Link href={`/v2/check-in/${step}`} className="v2-small v2-text-link">
            {t("change")}
            <span className="v2-sr-only"> – {title}</span>
          </Link>
        </div>
        <dl className="v2-rows">
          {items.map((item) => (
            <div key={item.field} className="v2-row">
              <dt>{item.label ?? t(`fields.${item.field as RegistrationField}`)}</dt>
              <dd className="v2-text" style={{ overflowWrap: "anywhere" }}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );

  const companions = stepPositions(journey, "guests").filter((position) => position > 0);
  const billing = journey.registration?.billing;
  const company = billingRows(billing, countryName);
  const status = reviewStatusRows(journey);
  return (
    <div>
      {section("primary", t("review.primary"), "guests", rows("guests", 0))}
      {companions.map((position) =>
        section(
          `companion-${String(position)}`,
          t("companion", { number: position + 1 }),
          "guests",
          rows("guests", position),
        ),
      )}
      {steps.includes("address") &&
        section(
          "address",
          t("review.address"),
          "address",
          rows("address", 0, (field) => !DOCUMENT_FIELDS.has(field)),
        )}
      {steps.includes("address") &&
        section(
          "document",
          t("review.document"),
          "address",
          rows("address", 0, (field) => DOCUMENT_FIELDS.has(field)),
        )}
      {steps.includes("billing") &&
        section(
          "billing",
          t("review.billing"),
          "billing",
          company.length > 0
            ? company.map((row) => ({
                field: row.id,
                label: t(`billing.fields.${row.id as "companyName"}`),
                value: row.value,
              }))
            : [
                {
                  field: "billingKind",
                  label: t("billing.choiceLabel"),
                  value: t("review.billingPrivate"),
                },
              ],
        )}
      {status.length > 0 && (
        <section className="v2-stack" style={{ marginTop: 36 }}>
          <div className="v2-section-head">
            <h2 className="v2-eyebrow">{t("review.status")}</h2>
          </div>
          <dl className="v2-rows">
            {status.map((row) => (
              <div key={row.id} className="v2-row">
                <dt>{t(`status.labels.${row.id}`)}</dt>
                <dd className={row.open ? "v2-text v2-muted" : "v2-text"}>
                  {t(`status.values.${row.value}` as "status.values.data.complete")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
