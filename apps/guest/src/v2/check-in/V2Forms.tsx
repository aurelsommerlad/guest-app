"use client";

import { type CallingCodeOption, Icon, type SelectOption } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { CheckInFormState } from "../../features/check-in/action-handlers";
import type {
  BillingFieldDef,
  BillingForm,
  FormFieldDef,
  GuestFieldset,
} from "../../features/check-in/form-model";
import { V2Arrow } from "../components/glyphs";
import { V2PhoneField, V2SelectField, V2TextField } from "./V2Fields";

type Action = (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;

function SubmitButton({
  pending,
  label,
  busy,
  disabled = false,
}: {
  pending: boolean;
  label: string;
  busy: string;
  disabled?: boolean;
}) {
  return (
    <button type="submit" className="v2-button" disabled={pending || disabled}>
      <span>{pending ? busy : label}</span>
      <V2Arrow />
    </button>
  );
}

function Notice({ text }: { text?: string }) {
  return (
    <div role="status" className="empty:hidden">
      {text && <p className="v2-notice">{text}</p>}
    </div>
  );
}

/** Trip: confirm the stay – the travellers come from the reservation, nothing is asked. */
export function V2TripForm({ action }: { action: Action }) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const notice =
    state.status === "rate-limited"
      ? t("errors.rateLimited")
      : state.status === "idle"
        ? undefined
        : t("errors.unavailable");
  return (
    <form action={formAction} className="v2-form">
      <Notice {...(notice ? { text: notice } : {})} />
      <SubmitButton pending={pending} label={t("next")} busy={t("saving")} />
    </form>
  );
}

const SPANS: Record<FormFieldDef["field"], string> = {
  firstName: "v2-span-3",
  lastName: "v2-span-3",
  email: "v2-span-6",
  phone: "v2-span-6",
  birthDate: "v2-span-3",
  nationality: "v2-span-3",
  street: "v2-span-6",
  postalCode: "v2-span-2",
  city: "v2-span-4",
  country: "v2-span-6",
  documentType: "v2-span-3",
  documentNumber: "v2-span-3",
};

const DOCUMENT_FIELDS = new Set<FormFieldDef["field"]>(["documentType", "documentNumber"]);
const ADDRESS_FIELDS = new Set<FormFieldDef["field"]>(["street", "postalCode", "city", "country"]);

/**
 * Guests / address. Same field names, validation and saving as the current app (form-model,
 * server-side checks); only the presentation is editorial: numbered persons separated by
 * hairlines, underline inputs. Works without JavaScript.
 */
export function V2GuestStepForm({
  action,
  step,
  fieldsets,
  version,
  countries,
  callingCodes,
  documentTypes,
  maxBirthDate,
  occupancyChangedTo,
}: {
  action: Action;
  step: "guests" | "address";
  fieldsets: readonly GuestFieldset[];
  version: number;
  countries: readonly SelectOption[];
  callingCodes: readonly CallingCodeOption[];
  documentTypes: readonly SelectOption[];
  maxBirthDate: string;
  occupancyChangedTo?: number;
}) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const errors = state.status === "idle" ? undefined : state.errors;
  const values = state.status === "idle" ? undefined : state.values;
  const currentVersion = (state.status !== "idle" && state.version) || version;

  // After an error the server recomputes the labels from the echoed answers.
  const requirementOf = (def: FormFieldDef) =>
    (state.status === "idle" ? undefined : state.requirements?.[def.name]) ?? def.requirement;
  const label = (def: FormFieldDef) =>
    requirementOf(def) === "optional"
      ? `${t(`fields.${def.field}`)} (${t("optional")})`
      : t(`fields.${def.field}`);

  const field = (position: number, def: FormFieldDef) => {
    const code = errors?.[position]?.find((item) => item.field === def.field)?.code ?? def.error;
    const error = code ? t(`errors.${code}`) : undefined;
    const common = {
      id: def.name,
      name: def.name,
      label: label(def),
      required: requirementOf(def) === "required",
      // May become required by an answer still missing (age, nationality) – say so.
      ...(requirementOf(def) === "conditional" ? { hint: t("hints.conditional") } : {}),
      autoComplete: def.autoComplete,
      defaultValue: values?.[def.name] ?? def.value,
      className: SPANS[def.field],
      ...(error ? { error } : {}),
    };
    if (def.kind === "phone") {
      return (
        <V2PhoneField
          key={`${def.name}-${values?.[`${def.name}Country`] ?? def.phoneCountry ?? ""}`}
          {...common}
          countryName={`${def.name}Country`}
          countryLabel={t("fields.phoneCountry")}
          options={callingCodes}
          defaultCountry={values?.[`${def.name}Country`] ?? def.phoneCountry ?? "DE"}
          hint={t("hints.phone")}
        />
      );
    }
    if (def.kind === "country" || def.kind === "document-type") {
      return (
        <V2SelectField
          // Keyed by value: a native select keeps its first default, so it remounts to show
          // the value echoed after a server-side validation error.
          key={`${def.name}-${common.defaultValue}`}
          {...common}
          options={def.kind === "country" ? countries : documentTypes}
          placeholder={t("choose")}
        />
      );
    }
    return (
      <V2TextField
        key={def.name}
        {...common}
        type={def.kind === "date" ? "date" : def.kind === "email" ? "email" : "text"}
        {...(def.kind === "date"
          ? { min: "1900-01-01", max: maxBirthDate }
          : def.kind === "email"
            ? { maxLength: 254, inputMode: "email" as const, hint: t("hints.email") }
            : { maxLength: 100 })}
      />
    );
  };
  const grid = (position: number, defs: readonly FormFieldDef[]) => (
    <div className="v2-fields">{defs.map((def) => field(position, def))}</div>
  );

  const notice =
    state.status === "invalid"
      ? state.saved
        ? t("errors.summary")
        : t("errors.summaryNotSaved")
      : state.status === "conflict"
        ? t("errors.conflict")
        : state.status === "rate-limited"
          ? t("errors.rateLimited")
          : state.status === "unavailable"
            ? t("errors.unavailable")
            : undefined;
  const firstIncomplete = fieldsets.find((set) => !set.complete)?.position;
  const [primary] = fieldsets;
  const prefilled = (show: boolean) =>
    show && (
      <p className="v2-caption" style={{ marginBottom: 20 }}>
        {t("prefilledHint")}
      </p>
    );

  return (
    <form action={formAction} className="v2-form" noValidate>
      <input type="hidden" name="version" value={currentVersion} />
      {occupancyChangedTo !== undefined && state.status === "idle" && (
        <p className="v2-notice">{t("occupancyChanged", { count: occupancyChangedTo })}</p>
      )}
      <Notice {...(notice ? { text: notice } : {})} />

      {step === "address" && primary && (
        <div className="v2-stack" style={{ gap: 44 }}>
          {primary.fields.some((def) => !DOCUMENT_FIELDS.has(def.field)) && (
            <section className="v2-stack v2-stack-4">
              <h2 className="v2-section-head v2-eyebrow">{t("addressCard")}</h2>
              <div style={{ paddingTop: 8 }}>
                {prefilled(primary.prefilled)}
                {grid(
                  primary.position,
                  primary.fields.filter((def) => !DOCUMENT_FIELDS.has(def.field)),
                )}
              </div>
            </section>
          )}
          {primary.fields.some((def) => DOCUMENT_FIELDS.has(def.field)) && (
            <section className="v2-stack v2-stack-4">
              <h2 className="v2-section-head v2-eyebrow">{t("document.title")}</h2>
              <p className="v2-body v2-muted">{t("document.body")}</p>
              {grid(
                primary.position,
                primary.fields.filter((def) => DOCUMENT_FIELDS.has(def.field)),
              )}
            </section>
          )}
        </div>
      )}

      {step === "guests" && (
        <div>
          {fieldsets.map((set) => {
            const hasErrors = (errors?.[set.position]?.length ?? 0) > 0;
            const done = set.complete && !hasErrors;
            const open = hasErrors || (!set.complete && set.position === firstIncomplete);
            const status = done
              ? t("companionComplete")
              : set.missing.length > 0 && set.displayName
                ? t("personMissing", {
                    fields: set.missing.map((missing) => t(`fields.${missing}`)).join(", "),
                  })
                : set.displayName
                  ? t("companionIncomplete")
                  : t("personEmpty");
            return (
              <details key={set.position} open={open} className="v2-person">
                <summary>
                  <span aria-hidden className="v2-person-number">
                    {String(set.position + 1).padStart(2, "0")}
                  </span>
                  <span className="v2-stack" style={{ gap: 3, minWidth: 0 }}>
                    <span className="v2-eyebrow">
                      {set.position === 0
                        ? t("primaryGuest")
                        : t("companion", { number: set.position + 1 })}
                    </span>
                    <span
                      className="v2-small v2-muted"
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {set.displayName ? `${set.displayName} · ${status}` : status}
                    </span>
                  </span>
                  {done ? (
                    <span className="v2-mark" aria-hidden>
                      <Icon name="check" />
                    </span>
                  ) : (
                    <Icon name="chevron-down" className="v2-person-chevron" />
                  )}
                </summary>
                <div className="v2-person-body">
                  {prefilled(set.prefilled)}
                  {set.sharedAddress ? (
                    <>
                      {grid(
                        set.position,
                        set.fields.filter((def) => !ADDRESS_FIELDS.has(def.field)),
                      )}
                      <label className="v2-check v2-shared">
                        <input
                          type="checkbox"
                          name={set.sharedAddress.name}
                          value="same-as-primary"
                          defaultChecked={
                            values?.[set.sharedAddress.name] !== undefined
                              ? values[set.sharedAddress.name] === "same-as-primary"
                              : set.sharedAddress.checked
                          }
                        />
                        <span className="v2-stack" style={{ gap: 4 }}>
                          <span className="v2-body">{t("sharedAddress")}</span>
                          <span className="v2-caption">{t("sharedAddressHint")}</span>
                        </span>
                      </label>
                      <div className="v2-shared-fields">
                        {grid(
                          set.position,
                          set.fields.filter((def) => ADDRESS_FIELDS.has(def.field)),
                        )}
                      </div>
                    </>
                  ) : (
                    grid(set.position, set.fields)
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <SubmitButton pending={pending} label={t("next")} busy={t("saving")} />
    </form>
  );
}

const BILLING_SPANS: Record<BillingFieldDef["name"], string> = {
  companyName: "v2-span-6",
  street: "v2-span-6",
  postalCode: "v2-span-2",
  city: "v2-span-4",
  country: "v2-span-6",
  vatId: "v2-span-6",
  contactFirstName: "v2-span-3",
  contactLastName: "v2-span-3",
};

/**
 * Optional invoice recipient (ADR 0021): private by default, or a company with its own
 * address – independent of the registration address. Works without JavaScript (:has).
 */
export function V2BillingForm({
  action,
  form,
  version,
  countries,
}: {
  action: Action;
  form: BillingForm;
  version: number;
  countries: readonly SelectOption[];
}) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const values = state.status === "idle" ? undefined : state.values;
  const issues = state.status === "idle" ? undefined : state.billingErrors;
  const kind = (values?.["billingKind"] ?? form.kind) === "company" ? "company" : "private";
  const notice =
    state.status === "invalid"
      ? t("errors.billingSummary")
      : state.status === "conflict"
        ? t("errors.conflict")
        : state.status === "rate-limited"
          ? t("errors.rateLimited")
          : state.status === "unavailable"
            ? t("errors.unavailable")
            : undefined;

  const field = (def: BillingFieldDef) => {
    const code =
      issues?.find(
        (issue) =>
          issue.field === def.name ||
          (issue.field === "contactPerson" &&
            (def.name === "contactFirstName" || def.name === "contactLastName")),
      )?.code ?? def.error;
    const error = code ? t(`errors.${code}`) : undefined;
    const text = t(`billing.fields.${def.name}`);
    const common = {
      id: `billing-${def.name}`,
      name: def.name,
      label: def.required || def.name.startsWith("contact") ? text : `${text} (${t("optional")})`,
      required: def.required,
      autoComplete: def.autoComplete,
      defaultValue: values?.[def.name] ?? def.value,
      className: BILLING_SPANS[def.name],
      ...(error ? { error } : {}),
    };
    if (def.kind === "country") {
      return (
        <V2SelectField
          key={`${def.name}-${common.defaultValue}`}
          {...common}
          options={countries}
          placeholder={t("choose")}
        />
      );
    }
    return (
      <V2TextField
        key={def.name}
        {...common}
        maxLength={def.name === "companyName" || def.name === "street" ? 200 : 100}
        {...(def.name === "vatId" ? { hint: t("billing.vatIdHint") } : {})}
      />
    );
  };
  const company = form.fields.filter((def) => !def.name.startsWith("contact"));
  const contact = form.fields.filter((def) => def.name.startsWith("contact"));

  return (
    <form action={formAction} className="v2-form v2-billing" noValidate>
      <input type="hidden" name="version" value={version} />
      <Notice {...(notice ? { text: notice } : {})} />
      <fieldset className="v2-choice">
        <legend className="v2-sr-only">{t("billing.choiceLabel")}</legend>
        {(["private", "company"] as const).map((option) => (
          <label key={option} className="v2-check">
            <input
              type="radio"
              name="billingKind"
              value={option}
              defaultChecked={kind === option}
            />
            <span className="v2-stack" style={{ gap: 4 }}>
              <span className="v2-body">{t(`billing.${option}`)}</span>
              <span className="v2-caption">{t(`billing.${option}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="v2-billing-company v2-stack" style={{ gap: 44 }}>
        <section className="v2-stack v2-stack-4">
          <h2 className="v2-section-head v2-eyebrow">{t("billing.companyTitle")}</h2>
          <div className="v2-fields">{company.map(field)}</div>
        </section>
        <section className="v2-stack v2-stack-4">
          <h2 className="v2-section-head v2-eyebrow">{t("billing.contactTitle")}</h2>
          <div className="v2-fields">{contact.map(field)}</div>
        </section>
        <p className="v2-caption">{t("billing.note")}</p>
      </div>
      <SubmitButton pending={pending} label={t("next")} busy={t("saving")} />
    </form>
  );
}

/** Confirmation and the one submit (idempotent on the server). */
export function V2SubmitForm({
  action,
  version,
  blocked = false,
}: {
  action: Action;
  version: number;
  /** A required confirmation is still open (the server checks it again). */
  blocked?: boolean;
}) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const message =
    blocked || state.status === "contact-not-verified"
      ? t("errors.contactNotVerified")
      : state.status === "not-confirmed"
        ? t("errors.notConfirmed")
        : state.status === "conflict"
          ? t("errors.conflict")
          : state.status === "rate-limited"
            ? t("errors.rateLimited")
            : state.status === "unavailable"
              ? t("errors.unavailable")
              : undefined;
  return (
    <form action={formAction} className="v2-form" noValidate>
      <input type="hidden" name="version" value={version} />
      <label className="v2-check">
        <input type="checkbox" name="confirm" value="yes" required />
        <span className="v2-body">{t("confirm")}</span>
      </label>
      <Notice {...(message ? { text: message } : {})} />
      <SubmitButton
        pending={pending}
        disabled={blocked}
        label={t("submit")}
        busy={t("submitting")}
      />
      <p className="v2-caption">{t("privacy")}</p>
    </form>
  );
}
