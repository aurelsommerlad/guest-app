"use client";

import { Button } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { CheckInFormState } from "../actions";

type Props = {
  action: (previous: CheckInFormState, formData: FormData) => Promise<CheckInFormState>;
  version: number;
};

/** Confirmation and the one submit. A second click or tab is harmless (idempotent). */
export function SubmitForm({ action, version }: Props) {
  const t = useTranslations("checkIn");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const message =
    state.status === "not-confirmed"
      ? t("errors.notConfirmed")
      : state.status === "conflict"
        ? t("errors.conflict")
        : state.status === "rate-limited"
          ? t("errors.rateLimited")
          : state.status === "unavailable"
            ? t("errors.unavailable")
            : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="version" value={version} />
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          required
          className="mt-1 size-5 shrink-0 accent-text"
          aria-describedby={message ? "submit-message" : undefined}
        />
        <span className="type-body text-text">{t("confirm")}</span>
      </label>
      <div role="status" className="empty:hidden">
        {message && (
          <p id="submit-message" className="type-small rounded-card bg-surface p-4 text-text">
            {message}
          </p>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="type-small text-text-muted">{t("privacy")}</p>
    </form>
  );
}
