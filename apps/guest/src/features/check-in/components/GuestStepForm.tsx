"use client";

import {
  Button,
  type CallingCodeOption,
  Callout,
  Icon,
  type IconName,
  PhoneField,
  SelectField,
  type SelectOption,
  TextField,
} from "@up/ui";
import { useTranslations } from "next-intl";
import { type ReactNode, useActionState } from "react";

import type { CheckInFormState } from "../actions";
import type { FormFieldDef, GuestFieldset } from "../form-model";

type Props = {
  action: (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;
  step: "guests" | "address";
  fieldsets: readonly GuestFieldset[];
  version: number;
  countries: readonly SelectOption[];
  callingCodes: readonly CallingCodeOption[];
  documentTypes: readonly SelectOption[];
  /** Latest date allowed for birth dates (YYYY-MM-DD, property-local today). */
  maxBirthDate: string;
  /** Set when the reservation's occupancy changed this draft: the new number of travellers. */
  occupancyChangedTo?: number;
};

/** Grid spans (6-column grid): names side by side from 480 px, postcode next to city. */
const SPANS: Record<FormFieldDef["field"], string> = {
  firstName: "col-span-6 sm:col-span-3",
  lastName: "col-span-6 sm:col-span-3",
  email: "col-span-6",
  phone: "col-span-6",
  birthDate: "col-span-6 sm:col-span-3",
  nationality: "col-span-6 sm:col-span-3",
  street: "col-span-6",
  postalCode: "col-span-2",
  city: "col-span-4",
  country: "col-span-6",
  documentType: "col-span-6 sm:col-span-3",
  documentNumber: "col-span-6 sm:col-span-3",
};

const DOCUMENT_FIELDS = new Set<FormFieldDef["field"]>(["documentType", "documentNumber"]);

function FieldCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-4 text-text xs:p-5">
      <h2 className="flex items-center gap-3">
        <Icon name={icon} size="md" />
        <span className="type-eyebrow">{title}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * One check-in step. "guests": every booked traveller as an accordion item (main guest
 * first) – complete persons collapse, persons with missing data say what is missing,
 * values from the booking are marked once. Inputs of collapsed persons stay in the form.
 * Works without JavaScript.
 */
export function GuestStepForm({
  action,
  step,
  fieldsets,
  version,
  countries,
  callingCodes,
  documentTypes,
  maxBirthDate,
  occupancyChangedTo,
}: Props) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const errors = state.status === "idle" ? undefined : state.errors;
  const values = state.status === "idle" ? undefined : state.values;
  const currentVersion = (state.status !== "idle" && state.version) || version;

  const label = (def: FormFieldDef) =>
    def.required ? t(`fields.${def.field}`) : `${t(`fields.${def.field}`)} (${t("optional")})`;

  const field = (position: number, def: FormFieldDef) => {
    const code = errors?.[position]?.find((item) => item.field === def.field)?.code ?? def.error;
    const error = code ? t(`errors.${code}`) : undefined;
    if (def.kind === "phone") {
      return (
        <PhoneField
          // Remount when the echoed calling code changes (after a failed save).
          key={`${def.name}-${values?.[`${def.name}Country`] ?? def.phoneCountry ?? ""}`}
          id={def.name}
          name={def.name}
          countryName={`${def.name}Country`}
          label={label(def)}
          countryLabel={t("fields.phoneCountry")}
          options={callingCodes}
          defaultCountry={values?.[`${def.name}Country`] ?? def.phoneCountry ?? "DE"}
          defaultValue={values?.[def.name] ?? def.value}
          hint={t("hints.phone")}
          required={def.required}
          autoComplete={def.autoComplete}
          className={SPANS[def.field]}
          {...(error ? { error } : {})}
        />
      );
    }
    const common = {
      id: def.name,
      name: def.name,
      label: label(def),
      required: def.required,
      autoComplete: def.autoComplete,
      defaultValue: values?.[def.name] ?? def.value,
      className: SPANS[def.field],
      ...(error ? { error } : {}),
    };
    if (def.kind === "country") {
      return (
        <SelectField key={def.name} {...common} options={countries} placeholder={t("choose")} />
      );
    }
    if (def.kind === "document-type") {
      return (
        <SelectField key={def.name} {...common} options={documentTypes} placeholder={t("choose")} />
      );
    }
    return (
      <TextField
        key={def.name}
        {...common}
        type={def.kind === "date" ? "date" : def.kind === "email" ? "email" : "text"}
        {...(def.kind === "date"
          ? { min: "1900-01-01", max: maxBirthDate }
          : def.kind === "email"
            ? { maxLength: 254, inputMode: "email" as const, hint: t("hints.email") }
            : { maxLength: 100 })}
        spellCheck={false}
      />
    );
  };
  const grid = (position: number, defs: readonly FormFieldDef[]) => (
    <div className="grid grid-cols-6 gap-x-3 gap-y-4">
      {defs.map((def) => field(position, def))}
    </div>
  );

  const notice =
    state.status === "invalid"
      ? t("errors.summary")
      : state.status === "conflict"
        ? t("errors.conflict")
        : state.status === "rate-limited"
          ? t("errors.rateLimited")
          : state.status === "unavailable"
            ? t("errors.unavailable")
            : undefined;

  const firstIncomplete = fieldsets.find((set) => !set.complete)?.position;
  const [primary] = fieldsets;
  const personLabel = (position: number) =>
    position === 0 ? t("primaryGuest") : t("companion", { number: position + 1 });

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="version" value={currentVersion} />
      {occupancyChangedTo !== undefined && state.status === "idle" && (
        <Callout icon="users" tone="sage">
          {t("occupancyChanged", { count: occupancyChangedTo })}
        </Callout>
      )}
      <div role="status" className="empty:hidden">
        {notice && (
          <Callout icon="info" className="items-start">
            {notice}
          </Callout>
        )}
      </div>

      {step === "address" && primary && (
        <>
          {primary.fields.some((def) => !DOCUMENT_FIELDS.has(def.field)) && (
            <FieldCard title={t("addressCard")} icon="map-pin">
              {primary.prefilled && (
                <p className="type-caption mb-4 flex items-start gap-2 text-text-muted">
                  <Icon name="circle-check" size="sm" className="mt-px shrink-0 text-success" />
                  <span>{t("prefilledHint")}</span>
                </p>
              )}
              {grid(
                primary.position,
                primary.fields.filter((def) => !DOCUMENT_FIELDS.has(def.field)),
              )}
            </FieldCard>
          )}
          {primary.fields.some((def) => DOCUMENT_FIELDS.has(def.field)) && (
            <FieldCard title={t("document.title")} icon="id-card">
              <p className="type-small text-text-muted">{t("document.body")}</p>
              {/* Prepared place for a later camera scan – deliberately not interactive yet. */}
              <div className="mt-4 flex items-start gap-3 rounded-control border border-dashed border-border p-4">
                <Icon name="scan" size="lg" className="shrink-0 text-text-muted" />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="type-small flex flex-wrap items-center gap-2 text-text">
                    {t("document.scanTitle")}
                    <span className="type-caption rounded-full bg-background px-2.5 py-0.5 text-text-muted">
                      {t("document.scanSoon")}
                    </span>
                  </p>
                  <p className="type-caption text-text-muted">{t("document.scanBody")}</p>
                </div>
              </div>
              <div className="mt-4">
                {grid(
                  primary.position,
                  primary.fields.filter((def) => DOCUMENT_FIELDS.has(def.field)),
                )}
              </div>
            </FieldCard>
          )}
        </>
      )}

      {step === "guests" &&
        fieldsets.map((set) => {
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
            <details
              key={set.position}
              open={open}
              className="group rounded-card bg-surface text-text"
            >
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-card p-4 [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden
                  className={
                    "flex size-9 shrink-0 items-center justify-center rounded-full " +
                    (done ? "bg-success text-on-success" : "border border-text-muted type-small")
                  }
                >
                  {done ? (
                    <Icon name="check" size="sm" />
                  ) : set.position === 0 ? (
                    <Icon name="user" size="sm" />
                  ) : (
                    set.position + 1
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-title">{personLabel(set.position)}</span>
                  <span className="type-caption truncate text-text-muted">
                    {set.displayName ? `${set.displayName} · ${status}` : status}
                  </span>
                </span>
                <Icon
                  name="chevron-down"
                  size="md"
                  className="shrink-0 text-text-muted group-open:rotate-180"
                />
              </summary>
              <div className="border-t border-border p-4 xs:p-5">
                {set.prefilled && (
                  <p className="type-caption mb-4 flex items-start gap-2 text-text-muted">
                    <Icon name="circle-check" size="sm" className="mt-px shrink-0 text-success" />
                    <span>{t("prefilledHint")}</span>
                  </p>
                )}
                {grid(set.position, set.fields)}
              </div>
            </details>
          );
        })}

      <Button
        type="submit"
        variant="primary"
        iconEnd="arrow-right"
        disabled={pending}
        className="mt-2 w-full sm:w-auto sm:self-start"
      >
        {pending ? t("saving") : t("next")}
      </Button>
    </form>
  );
}
