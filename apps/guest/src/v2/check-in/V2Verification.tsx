"use client";

import { Icon } from "@up/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { VerificationFormState } from "../../features/check-in/action-handlers";
import type { VerificationPanelView } from "../../features/check-in/verification-view";
import { Link } from "../../i18n/navigation";
import { V2Arrow } from "../components/glyphs";
import { V2TextField } from "./V2Fields";

type Action = (
  previous: VerificationFormState,
  formData: FormData,
) => Promise<VerificationFormState>;

/**
 * E-mail confirmation on the review step (ADR 0021, C4) – editorial: a section head, one
 * line of text, the code field and a single primary button. Works without JavaScript.
 * A confirmed or waived address is stated as such; nothing else is shown as confirmed.
 */
export function V2EmailVerification({
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
    if (state.reason === "wrong-code") {
      return t("errors.wrong-code", { count: state.attemptsLeft ?? 0 });
    }
    if (state.reason === "cooldown" && state.retryAt) {
      const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(
        new Date(state.retryAt),
      );
      return t("errors.cooldownUntil", { time });
    }
    return t(`errors.${state.reason}`);
  };

  if (view.status === "verified" || view.status === "waived") {
    return (
      <section className="v2-stack" style={{ marginTop: 8 }}>
        <div className="v2-section-head">
          <h2 className="v2-eyebrow">{t("title")}</h2>
        </div>
        <p className="v2-body" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="v2-mark" aria-hidden>
            <Icon name="check" />
          </span>
          {view.status === "verified"
            ? t("verifiedBody", { email: masked })
            : t("waivedBody", { email: masked })}
        </p>
      </section>
    );
  }

  if (!view.offered) {
    // No sender active (or switched off): say what happens, never block the guest.
    return view.required ? (
      <section className="v2-stack" style={{ marginTop: 8 }}>
        <div className="v2-section-head">
          <h2 className="v2-eyebrow">{t("title")}</h2>
        </div>
        <p className="v2-body v2-muted">{t("notOffered")}</p>
      </section>
    ) : null;
  }

  const sendError = errorText(sendState);
  const confirmError = errorText(confirmState);
  const pending = view.pending;
  const locked = view.status === "locked";

  return (
    <section className="v2-stack v2-verify" style={{ gap: 22, marginTop: 8 }} aria-live="polite">
      <div className="v2-section-head">
        <h2 className="v2-eyebrow">{t("title")}</h2>
        <Link href="/v2/check-in/guests" className="v2-small v2-text-link">
          {t("change")}
        </Link>
      </div>
      <p className="v2-body">
        {pending && !locked
          ? t("sentTo", { email: masked, minutes: view.validMinutes })
          : t(view.required ? "introRequired" : "introOptional", { email: masked })}
      </p>
      {pending?.simulated && <p className="v2-caption">{t("simulatedHint")}</p>}
      {locked && <p className="v2-notice">{t("errors.locked")}</p>}

      {pending && !locked && (
        <form action={confirm} className="v2-form" noValidate style={{ gap: 18 }}>
          <V2TextField
            id="verify-code"
            name="code"
            label={t("codeLabel")}
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={9}
            className="v2-span-6"
            {...(confirmError ? { error: confirmError } : {})}
          />
          <button type="submit" className="v2-button" disabled={confirming}>
            <span>{confirming ? t("confirming") : t("confirm")}</span>
            <V2Arrow />
          </button>
        </form>
      )}

      <form action={send} className="v2-stack" style={{ gap: 8 }}>
        {pending && !locked ? (
          <button type="submit" className="v2-small v2-text-link v2-link-button" disabled={sending}>
            {sending ? t("sending") : t("resend")}
          </button>
        ) : (
          <button type="submit" className="v2-button" disabled={sending}>
            <span>{sending ? t("sending") : t("send")}</span>
            <V2Arrow />
          </button>
        )}
        <div role="status" className="empty:hidden">
          {sendError && <p className="v2-notice">{sendError}</p>}
        </div>
        {pending && !locked && <p className="v2-caption">{t("noMail")}</p>}
      </form>
    </section>
  );
}
