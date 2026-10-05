"use client";

import { Button, TextField } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { type LoginFormState } from "../login-action";

type Props = {
  action: (previous: LoginFormState, formData: FormData) => Promise<LoginFormState>;
};

/** Booking number + last name. One neutral message for every failed combination. */
export function LoginForm({ action }: Props) {
  const t = useTranslations("access.login");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const values = state.status === "idle" ? undefined : state;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <TextField
        id="bookingReference"
        name="bookingReference"
        label={t("bookingReference")}
        hint={t("bookingReferenceHint")}
        defaultValue={values?.bookingReference}
        required
        maxLength={60}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
      <TextField
        id="lastName"
        name="lastName"
        label={t("lastName")}
        defaultValue={values?.lastName}
        required
        maxLength={100}
        autoComplete="family-name"
        spellCheck={false}
      />
      <div role="status" className="empty:-mt-6">
        {state.status === "not-found" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">{t("notFound")}</p>
        )}
        {state.status === "rate-limited" && (
          <p className="type-small rounded-card bg-surface p-4 text-text">
            {t("rateLimited", { minutes: state.retryAfterMinutes ?? 15 })}
          </p>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
