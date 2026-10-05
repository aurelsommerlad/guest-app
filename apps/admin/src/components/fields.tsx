import { cx } from "@up/ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** Admin form fields on top of the design tokens (labels always visible). */

const control =
  "type-body w-full min-w-0 rounded-control border border-text-muted bg-background px-3 text-text";

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="type-eyebrow text-text">
        {label}
      </label>
      {children}
      {hint && <p className="type-caption text-text-muted">{hint}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentPropsWithoutRef<"input">) {
  return <input className={cx(control, "min-h-11", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: ComponentPropsWithoutRef<"textarea">) {
  return <textarea className={cx(control, "min-h-28 py-2", className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentPropsWithoutRef<"select">) {
  return <select className={cx(control, "min-h-11", className)} {...rest} />;
}

/** German (source) and English side by side. */
export function LocalizedPair({
  label,
  children,
}: {
  label: string;
  children: [ReactNode, ReactNode];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="type-eyebrow pb-1.5 text-text">{label}</legend>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function FormMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role="status"
      className={cx(
        "type-small rounded-card p-3",
        state.status === "error" ? "bg-surface text-text" : "bg-surface-accent text-on-accent",
      )}
    >
      {state.message}
    </p>
  );
}
