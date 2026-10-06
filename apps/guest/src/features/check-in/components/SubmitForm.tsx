"use client";

import { Button, Callout, Icon } from "@up/ui";
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
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="version" value={version} />
      <label className="flex cursor-pointer items-start gap-3 rounded-card border border-border bg-surface-raised p-4">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          required
          className="mt-0.5 size-5 shrink-0 accent-success"
          aria-describedby={message ? "submit-message" : undefined}
        />
        <span className="type-small text-text">{t("confirm")}</span>
      </label>
      <div role="status" className="empty:hidden">
        {message && (
          <Callout icon="info">
            <span id="submit-message">{message}</span>
          </Callout>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        iconEnd="arrow-right"
        disabled={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="type-caption flex items-start gap-2 text-text-muted">
        <Icon name="lock" size="sm" className="mt-px shrink-0" />
        <span>{t("privacy")}</span>
      </p>
    </form>
  );
}
