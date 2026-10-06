"use client";

import { Button } from "@up/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import type { RevealResult } from "../../journey/access-actions";
import { revealAccessCode } from "../../journey/access-actions";

/**
 * Shows the access code only after an explicit tap. The code lives in component state
 * only (no storage, no URL) and is hidden again on demand.
 */
export function AccessCodeReveal() {
  const t = useTranslations("stay.access");
  const [result, setResult] = useState<RevealResult | undefined>();
  const [pending, startTransition] = useTransition();

  if (result?.status === "ok") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-4 py-3">
        <p className="flex flex-col gap-1">
          <span className="type-caption text-text-muted">{t("code")}</span>
          <span className="type-figure tracking-widest" aria-live="polite">
            {result.code}
          </span>
        </p>
        <Button
          type="button"
          variant="secondary"
          iconStart="x"
          onClick={() => {
            setResult(undefined);
          }}
        >
          {t("hide")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="primary"
        iconStart="key"
        className="w-full sm:w-auto sm:self-start"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setResult(await revealAccessCode());
          });
        }}
      >
        {pending ? t("revealing") : t("reveal")}
      </Button>
      <p className="type-caption text-text-muted">{t("codeHint")}</p>
      <div role="status" className="empty:hidden">
        {result?.status === "unavailable" && (
          <p className="type-small text-text-muted">{t("revealUnavailable")}</p>
        )}
        {result?.status === "rate-limited" && (
          <p className="type-small text-text-muted">{t("revealRateLimited")}</p>
        )}
      </div>
    </div>
  );
}
