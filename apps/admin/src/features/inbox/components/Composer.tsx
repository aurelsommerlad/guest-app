"use client";

import { cx, Icon } from "@up/ui";
import { useActionState, useEffect, useRef, useState } from "react";

import { type ComposerState, sendComposerAction } from "../actions";

const LIMITS = { reply: 8000, note: 4000 } as const;

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Reply field of a conversation: grows with the text (long replies are fine), sends with the
 * button or ⌘/Ctrl + Enter, and never sends twice (one client message id per draft).
 */
export function Composer({
  conversationId,
  channelHint,
  canReply,
  canNote,
}: {
  conversationId: string;
  channelHint: string;
  canReply: boolean;
  canNote: boolean;
}) {
  const [mode, setMode] = useState<"reply" | "note">(canReply ? "reply" : "note");
  const [value, setValue] = useState("");
  const [clientMessageId, setClientMessageId] = useState(newId);
  const [state, action, pending] = useActionState<ComposerState, FormData>(
    async (previous, formData) => {
      const sent = formData.get("text");
      const result = await sendComposerAction(previous, formData);
      if (result.status === "sent") {
        // Keep anything typed while sending; clear only the text that was sent.
        setValue((current) => (current === sent ? "" : current));
        setClientMessageId(newId());
      }
      return result;
    },
    { status: "idle" },
  );
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${String(Math.min(element.scrollHeight, 320))}px`;
  }, [value]);

  if (!canReply && !canNote) {
    return (
      <p className="type-small border-t border-border py-4 text-text-muted">
        Du kannst diese Unterhaltung lesen, aber nicht antworten.
      </p>
    );
  }

  const limit = LIMITS[mode];
  const remaining = limit - value.length;
  const empty = value.trim().length === 0;

  return (
    <form
      ref={form}
      action={action}
      className="sticky bottom-0 z-10 border-t border-text bg-background pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      data-testid="composer"
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="clientMessageId" value={clientMessageId} />
      <input type="hidden" name="mode" value={mode} />
      {canReply && canNote && (
        <div className="type-eyebrow mb-1 flex gap-5" role="tablist" aria-label="Art der Nachricht">
          {(["reply", "note"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              onClick={() => {
                setMode(option);
              }}
              className={cx(
                "min-h-9 border-b pb-1 md:min-h-0",
                mode === option ? "border-text text-text" : "border-transparent text-text-muted",
              )}
            >
              {option === "reply" ? "Antwort an Gast" : "Interne Notiz"}
            </button>
          ))}
        </div>
      )}
      <label htmlFor={`composer-${conversationId}`} className="sr-only">
        {mode === "reply" ? "Antwort an den Gast" : "Interne Notiz für das Team"}
      </label>
      <div className="flex items-end gap-3">
        <textarea
          id={`composer-${conversationId}`}
          ref={textarea}
          name="text"
          value={value}
          rows={1}
          maxLength={limit}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !empty && !pending) {
              event.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          placeholder={mode === "reply" ? "Antwort schreiben …" : "Notiz nur für das Team …"}
          className={cx(
            "type-body block min-h-11 min-w-0 flex-1 resize-none border-b border-border bg-transparent py-2 text-text outline-none placeholder:text-text-muted focus:border-text",
            mode === "note" && "bg-surface px-3",
          )}
        />
        <button
          type="submit"
          disabled={empty || pending}
          aria-label={mode === "reply" ? "Senden" : "Notiz speichern"}
          className="type-small inline-flex size-11 shrink-0 items-center justify-center gap-2 bg-text text-text-inverse disabled:opacity-40 md:w-auto md:px-5"
        >
          <Icon name="send" size="sm" />
          <span className="hidden md:inline">
            {pending ? "Wird gesendet …" : mode === "reply" ? "Senden" : "Notiz speichern"}
          </span>
        </button>
      </div>
      <p className="type-caption mt-2 truncate text-text-muted">
        {mode === "reply" ? channelHint : "Nur für berechtigte Mitarbeiter – nie für Gäste."}
        {remaining < 500 && ` · noch ${String(remaining)} Zeichen`}
      </p>
      {state.status === "error" && (
        <p role="alert" className="type-small mt-2 text-text">
          {state.message}
        </p>
      )}
    </form>
  );
}
