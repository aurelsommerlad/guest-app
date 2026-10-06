"use client";

import { Button, SelectField, type SelectOption, TextField } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { CheckInFormState } from "../actions";
import type { FormFieldDef, GuestFieldset } from "../form-model";

type Props = {
  action: (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;
  fieldsets: readonly GuestFieldset[];
  version: number;
  countries: readonly SelectOption[];
  documentTypes: readonly SelectOption[];
  /** Latest date allowed for birth dates (YYYY-MM-DD, property-local today). */
  maxBirthDate: string;
};

/** One check-in step for one or more travellers. Works without JavaScript, too. */
export function GuestStepForm({
  action,
  fieldsets,
  version,
  countries,
  documentTypes,
  maxBirthDate,
}: Props) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const errors = state.status === "idle" ? undefined : state.errors;
  const values = state.status === "idle" ? undefined : state.values;
  const currentVersion = (state.status !== "idle" && state.version) || version;

  const field = (position: number, def: FormFieldDef) => {
    const code = errors?.[position]?.find((item) => item.field === def.field)?.code ?? def.error;
    const common = {
      id: def.name,
      name: def.name,
      label: def.required
        ? t(`fields.${def.field}`)
        : `${t(`fields.${def.field}`)} (${t("optional")})`,
      required: def.required,
      autoComplete: def.autoComplete,
      defaultValue: values?.[def.name] ?? def.value,
      ...(code ? { error: t(`errors.${code}`) } : {}),
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
        type={def.kind === "date" ? "date" : "text"}
        {...(def.kind === "date" ? { min: "1900-01-01", max: maxBirthDate } : { maxLength: 100 })}
        spellCheck={false}
      />
    );
  };

  return (
    <form action={formAction} className="flex flex-col gap-10" noValidate>
      <input type="hidden" name="version" value={currentVersion} />
      <div role="status" className="empty:hidden">
        {state.status === "invalid" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">{t("errors.summary")}</p>
        )}
        {state.status === "conflict" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">{t("errors.conflict")}</p>
        )}
        {state.status === "rate-limited" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">
            {t("errors.rateLimited")}
          </p>
        )}
        {state.status === "unavailable" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">
            {t("errors.unavailable")}
          </p>
        )}
      </div>
      {fieldsets.map((fieldset) => (
        <fieldset key={fieldset.position} className="flex flex-col gap-6">
          {fieldset.position > 0 && (
            <legend className="type-title mb-6 text-text">
              {t("companion", { number: fieldset.position + 1 })}
            </legend>
          )}
          {fieldset.fields.map((def) => field(fieldset.position, def))}
        </fieldset>
      ))}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? t("saving") : t("next")}
      </Button>
    </form>
  );
}
