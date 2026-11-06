"use client";

import { Button, Callout, Icon, TextField } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "../../../i18n/navigation";
import type { VerificationFormState } from "../actions";
import type { VerificationPanelView } from "../verification-view";

type Action = (
  previous: VerificationFormState,
  formData: FormData,
) => Promise<VerificationFormState>;

/** E-mail confirmation on the review step – same flow and rules as design V2 (ADR 0021, C4). */
export function EmailVerification({
  view,
  sendAction,
  confirmAction,
  locale,
  timeZone,
}: {
  view: VerificationPanelView;
  sendAction: Action;
  confirmAction: Action;
  locale: string;
  timeZone: string;
}) {
  const t = useTranslations("checkIn.verify");
  const [sendState, send, sending] = useActionState(sendAction, { status: "idle" });
  const [confirmState, confirm, confirming] = useActionState(confirmAction, { status: "idle" });
  const masked = view.masked ?? "";
  const errorText = (state: VerificationFormState) => {
    if (state.status !== "error") return undefined;
    if (state.reason === "wrong-code")
      return t("errors.wrong-code", { count: state.attemptsLeft ?? 0 });
    if (state.reason === "cooldown" && state.retryAt) {
      const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(
        new Date(state.retryAt),
      );
      return t("errors.cooldownUntil", { time });
    }
    return t(`errors.${state.reason}`);
  };

  const card = (children: React.ReactNode) => (
    <section className="rounded-card bg-surface p-4 text-text xs:p-5" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="type-title flex items-center gap-2">
          <Icon name="mail" size="sm" />
          {t("title")}
        </h2>
        {view.status !== "verified" && view.status !== "waived" && view.offered && (
          <Link
            href="/check-in/guests"
            className="type-small inline-flex min-h-11 items-center text-action underline-offset-4 hover:underline"
          >
            {t("change")}
          </Link>
        )}
      </div>
      {children}
    </section>
  );

  if (view.status === "verified" || view.status === "waived") {
    return card(
      <p className="type-small flex items-center gap-2">
        <Icon name="circle-check" size="sm" className="text-success" />
        {view.status === "verified"
          ? t("verifiedBody", { email: masked })
          : t("waivedBody", { email: masked })}
      </p>,
    );
  }
  if (!view.offered) {
    return view.required
      ? card(<p className="type-small text-text-muted">{t("notOffered")}</p>)
      : null;
  }

  const pending = view.pending;
  const locked = view.status === "locked";
  const sendError = errorText(sendState);
  const confirmError = errorText(confirmState);
  return card(
    <div className="flex flex-col gap-4">
      <p className="type-small">
        {pending && !locked
          ? t("sentTo", { email: masked, minutes: view.validMinutes })
          : t(view.required ? "introRequired" : "introOptional", { email: masked })}
      </p>
      {pending?.simulated && <p className="type-caption text-text-muted">{t("simulatedHint")}</p>}
      {locked && <Callout icon="info">{t("errors.locked")}</Callout>}
      {pending && !locked && (
        <form action={confirm} data-verify="confirm" className="flex flex-col gap-3" noValidate>
          <TextField
            id="verify-code"
            name="code"
            label={t("codeLabel")}
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={9}
            spellCheck={false}
            {...(confirmError ? { error: confirmError } : {})}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={confirming}
            className="w-full sm:w-auto sm:self-start"
          >
            {confirming ? t("confirming") : t("confirm")}
          </Button>
        </form>
      )}
      <form action={send} data-verify="send" className="flex flex-col gap-2">
        <Button
          type="submit"
          variant={pending && !locked ? "secondary" : "primary"}
          disabled={sending}
          className="w-full sm:w-auto sm:self-start"
        >
          {sending ? t("sending") : pending && !locked ? t("resend") : t("send")}
        </Button>
        <div role="status" className="empty:hidden">
          {sendError && <Callout icon="info">{sendError}</Callout>}
        </div>
        {pending && !locked && <p className="type-caption text-text-muted">{t("noMail")}</p>}
      </form>
    </div>,
  );
}
