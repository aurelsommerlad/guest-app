"use client";

import { Button } from "@up/ui";
import { useActionState } from "react";

import { Field, FormMessage, Input } from "../../../components/fields";
import type { SettingsFormState } from "../actions";

export type ExtensionSettingsValues = {
  extensionNightEnabled: boolean;
  extensionDiscountPreArrivalOneNightGap: number;
  extensionDiscountPreArrivalStandard: number;
  extensionDiscountInHouseOneNightGap: number;
  extensionDiscountInHouseStandard: number;
  minSellableStayNights: number;
};

/** Extension nights of one property: on/off, four discounts, minimum sellable stay. */
export function ExtensionSettingsForm({
  values,
  action,
  readOnly,
}: {
  values: ExtensionSettingsValues;
  action: (previous: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const percent = (name: string, label: string, value: number, hint?: string) => (
    <Field label={label} htmlFor={name} {...(hint ? { hint } : {})}>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          type="number"
          min={0}
          max={90}
          step={1}
          defaultValue={value}
          className="max-w-28"
        />
        <span className="type-body text-text-muted">%</span>
      </div>
    </Field>
  );
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            name="extensionNightEnabled"
            className="mt-1 size-4"
            defaultChecked={values.extensionNightEnabled}
          />
          <span className="flex flex-col">
            <span className="type-body text-text">Verlängerungsnacht anbieten</span>
            <span className="type-caption text-text-muted">
              Gäste sehen „Eine Nacht länger“, wenn die Folgenacht frei ist.
            </span>
          </span>
        </label>
        <div className="grid gap-5 md:grid-cols-2">
          <fieldset className="flex flex-col gap-4">
            <legend className="type-eyebrow pb-1.5 text-text">Vor der Anreise</legend>
            {percent(
              "discountPreArrivalOneNightGap",
              "Rabatt bei 1-Nacht-Lücke",
              values.extensionDiscountPreArrivalOneNightGap,
              "Nach der Abreise wäre nur eine Nacht frei.",
            )}
            {percent(
              "discountPreArrivalStandard",
              "Rabatt Standard",
              values.extensionDiscountPreArrivalStandard,
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-4">
            <legend className="type-eyebrow pb-1.5 text-text">Während des Aufenthalts</legend>
            {percent(
              "discountInHouseOneNightGap",
              "Rabatt bei 1-Nacht-Lücke",
              values.extensionDiscountInHouseOneNightGap,
            )}
            {percent(
              "discountInHouseStandard",
              "Rabatt Standard",
              values.extensionDiscountInHouseStandard,
            )}
          </fieldset>
        </div>
        <Field
          label="Mindestbelegung (Nächte)"
          htmlFor="minSellableStayNights"
          hint="Kürzere freie Lücken gelten als nicht verkäuflich und erhalten den Lücken-Rabatt."
        >
          <Input
            id="minSellableStayNights"
            name="minSellableStayNights"
            type="number"
            min={1}
            max={30}
            defaultValue={values.minSellableStayNights}
            className="max-w-28"
          />
        </Field>
        <p className="type-caption text-text-muted">Leere Rabattfelder zählen als 0 %.</p>
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Speichern …" : "Speichern"}
        </Button>
      )}
    </form>
  );
}
