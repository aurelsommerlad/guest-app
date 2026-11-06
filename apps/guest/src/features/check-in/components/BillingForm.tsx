"use client";

import { Button, Callout, Icon, SelectField, type SelectOption, TextField } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { CheckInFormState } from "../actions";
import type { BillingFieldDef, BillingForm as BillingFormModel } from "../form-model";

type Props = {
  action: (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;
  form: BillingFormModel;
  version: number;
  countries: readonly SelectOption[];
};

const SPANS: Record<BillingFieldDef["name"], string> = {
  companyName: "col-span-6",
  street: "col-span-6",
  postalCode: "col-span-2",
  city: "col-span-4",
  country: "col-span-6",
  vatId: "col-span-6",
  contactFirstName: "col-span-6 sm:col-span-3",
  contactLastName: "col-span-6 sm:col-span-3",
};

/**
 * Optional invoice recipient (ADR 0021): private by default or a company with its own address,
 * independent of the registration address. The company part is shown via CSS (:has), so the
 * form also works without JavaScript; the server ignores it for "private".
 */
export function BillingForm({ action, form, version, countries }: Props) {
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
      className: SPANS[def.name],
      ...(error ? { error } : {}),
    };
    if (def.kind === "country") {
      return (
        <SelectField
          key={`${def.name}-${common.defaultValue}`}
          {...common}
          options={countries}
          placeholder={t("choose")}
        />
      );
    }
    return (
      <TextField
        key={def.name}
        {...common}
        maxLength={def.name === "companyName" || def.name === "street" ? 200 : 100}
        spellCheck={false}
        {...(def.name === "vatId" ? { hint: t("billing.vatIdHint") } : {})}
      />
    );
  };
  const grid = (defs: readonly BillingFieldDef[]) => (
    <div className="grid grid-cols-6 gap-x-3 gap-y-4">{defs.map(field)}</div>
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 [&:not(:has(.billing-company-toggle:checked))_.billing-company]:hidden"
      noValidate
    >
      <input type="hidden" name="version" value={version} />
      <div role="status" className="empty:hidden">
        {notice && (
          <Callout icon="info" className="items-start">
            {notice}
          </Callout>
        )}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t("billing.choiceLabel")}</legend>
        {(["private", "company"] as const).map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-start gap-3 rounded-card border border-border bg-surface p-4"
          >
            <input
              type="radio"
              name="billingKind"
              value={option}
              defaultChecked={kind === option}
              className={
                "mt-0.5 size-5 shrink-0 accent-success" +
                (option === "company" ? " billing-company-toggle" : "")
              }
            />
            <span className="flex flex-col gap-0.5">
              <span className="type-small text-text">{t(`billing.${option}`)}</span>
              <span className="type-caption text-text-muted">{t(`billing.${option}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="billing-company flex flex-col gap-4">
        <section className="rounded-card bg-surface p-4 text-text xs:p-5">
          <h2 className="type-title mb-4 flex items-center gap-2">
            <Icon name="map-pin" size="sm" />
            {t("billing.companyTitle")}
          </h2>
          {grid(form.fields.filter((def) => !def.name.startsWith("contact")))}
        </section>
        <section className="rounded-card bg-surface p-4 text-text xs:p-5">
          <h2 className="type-title mb-4 flex items-center gap-2">
            <Icon name="user" size="sm" />
            {t("billing.contactTitle")}
          </h2>
          {grid(form.fields.filter((def) => def.name.startsWith("contact")))}
        </section>
        <p className="type-caption flex items-start gap-2 text-text-muted">
          <Icon name="info" size="sm" className="mt-px shrink-0" />
          <span>{t("billing.note")}</span>
        </p>
      </div>
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
