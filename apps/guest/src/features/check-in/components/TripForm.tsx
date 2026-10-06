"use client";

import { Button, SelectField } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { CheckInFormState } from "../actions";

type Props = {
  action: (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;
  /** Asked only when the reservation does not know the number of travellers. */
  askGuestCount: boolean;
  guestCount?: number;
  maxTravellers: number;
};

export function TripForm({ action, askGuestCount, guestCount, maxTravellers }: Props) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const options = Array.from({ length: maxTravellers }, (_, index) => ({
    value: String(index + 1),
    label: t("trip.travellersCount", { count: index + 1 }),
  }));
  return (
    <form action={formAction} className="flex flex-col gap-8">
      {askGuestCount && (
        <SelectField
          id="guestCount"
          name="guestCount"
          label={t("trip.travellersQuestion")}
          options={options}
          defaultValue={guestCount === undefined ? "" : String(guestCount)}
          placeholder={t("choose")}
          required
          {...(state.status === "invalid" ? { error: t("errors.required") } : {})}
        />
      )}
      <div role="status" className="empty:hidden">
        {(state.status === "unavailable" || state.status === "conflict") && (
          <p className="type-small rounded-card bg-surface p-4 text-text">
            {t("errors.unavailable")}
          </p>
        )}
        {state.status === "rate-limited" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">
            {t("errors.rateLimited")}
          </p>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? t("saving") : t("next")}
      </Button>
    </form>
  );
}
