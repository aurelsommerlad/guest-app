import { type ComponentPropsWithoutRef } from "react";

import { cx } from "../lib/cx";

export type TextFieldProps = {
  /** Visible label (required – placeholders are no substitute). */
  label: string;
  /** Short help text below the field, linked via aria-describedby. */
  hint?: string;
  /** Validation message; marks the field invalid and is announced with it. */
  error?: string;
  id: string;
} & Omit<ComponentPropsWithoutRef<"input">, "id" | "children">;

export const fieldControlClass =
  "type-body min-h-12 w-full min-w-0 rounded-control border bg-background px-4 text-text";

/** Describedby ids of a field's hint and error. */
export function fieldDescription(id: string, hint?: string, error?: string) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return { hintId, errorId, describedBy };
}

/**
 * Calm single-line text input with a visible label.
 * Border in text-muted for ≥ 3:1 non-text contrast; focus uses the global focus ring.
 */
export function TextField({
  label,
  hint,
  error,
  id,
  className,
  type = "text",
  ...rest
}: TextFieldProps) {
  const { hintId, errorId, describedBy } = fieldDescription(id, hint, error);
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="type-eyebrow text-text">
        {label}
      </label>
      <input
        id={id}
        type={type}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(fieldControlClass, error ? "border-text" : "border-text-muted")}
        {...rest}
      />
      {error && (
        <p id={errorId} className="type-small text-text">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="type-small text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
