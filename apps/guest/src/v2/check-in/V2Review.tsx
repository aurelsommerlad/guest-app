import { type CheckInStep, type RegistrationField } from "@up/core";
import { formatPhone } from "@up/core/phone";
import { getTranslations } from "next-intl/server";

import {
  type GuestStep,
  stepFields,
  stepPositions,
} from "../../features/check-in/check-in-service";
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
    return stepFields(journey, step, position)
      .filter((field) => filter(field) && data[field])
      .map((field) => ({ field, value: display(field, data[field] ?? "") }));
  };
  const section = (
    key: string,
    title: string,
    step: GuestStep,
    items: { field: RegistrationField; value: string }[],
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
              <dt>{t(`fields.${item.field}`)}</dt>
              <dd className="v2-text" style={{ overflowWrap: "anywhere" }}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );

  const companions = stepPositions(journey, "guests").filter((position) => position > 0);
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
    </div>
  );
}
