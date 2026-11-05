"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import type { RevealResult } from "../../features/journey/access-actions";
import { revealAccessCode } from "../../features/journey/access-actions";

/**
 * V2 presentation of the access code. Same server action as the current app (session,
 * release and registration are checked again, rate-limited); the code only lives in state.
 */
export function V2AccessReveal() {
  const t = useTranslations("stay.access");
  const [result, setResult] = useState<RevealResult | undefined>();
  const [pending, startTransition] = useTransition();

  if (result?.status === "ok") {
    return (
      <div className="v2-code">
        <p className="v2-stack v2-stack-2">
          <span className="v2-eyebrow v2-muted">{t("code")}</span>
          <span className="v2-code-value" aria-live="polite">
            {result.code}
          </span>
        </p>
        <button
          type="button"
          className="v2-back"
          onClick={() => {
            setResult(undefined);
          }}
        >
          {t("hide")}
        </button>
      </div>
    );
  }

  return (
    <div className="v2-stack v2-stack-4">
      <button
        type="button"
        className="v2-button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setResult(await revealAccessCode());
          });
        }}
      >
        <span>{pending ? t("revealing") : t("reveal")}</span>
        <svg
          aria-hidden
          viewBox="0 0 18 10"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.1}
          className="v2-arrow"
        >
          <path d="M0.75 5h16.5M12.75 0.75 17.25 5l-4.5 4.25" />
        </svg>
      </button>
      <p className="v2-caption">{t("codeHint")}</p>
      <div role="status" className="empty:hidden">
        {result?.status === "unavailable" && <p className="v2-small">{t("revealUnavailable")}</p>}
        {result?.status === "rate-limited" && <p className="v2-small">{t("revealRateLimited")}</p>}
      </div>
    </div>
  );
}
