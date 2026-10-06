"use client";

import { Button, Callout } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { CheckInFormState } from "../actions";

type Props = {
  action: (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;
};

/** Confirms the trip. The number of travellers is the reservation's – never asked here. */
export function TripForm({ action }: Props) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div role="status" className="empty:hidden">
        {(state.status === "unavailable" ||
          state.status === "conflict" ||
          state.status === "invalid") && <Callout icon="info">{t("errors.unavailable")}</Callout>}
        {state.status === "rate-limited" && (
          <Callout icon="info">{t("errors.rateLimited")}</Callout>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        iconEnd="arrow-right"
        disabled={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {pending ? t("saving") : t("next")}
      </Button>
    </form>
  );
}
