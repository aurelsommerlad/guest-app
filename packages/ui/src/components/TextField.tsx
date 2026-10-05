import { type ComponentPropsWithoutRef } from "react";

import { cx } from "../lib/cx";

export type TextFieldProps = {
  /** Visible label (required – placeholders are no substitute). */
  label: string;
  /** Short help text below the field, linked via aria-describedby. */
  hint?: string;
  id: string;
} & Omit<ComponentPropsWithoutRef<"input">, "id" | "children">;

/**
 * Calm single-line text input with a visible label.
 * Border in text-muted for ≥ 3:1 non-text contrast; focus uses the global focus ring.
 */
export function TextField({ label, hint, id, className, type = "text", ...rest }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="type-eyebrow text-text">
        {label}
      </label>
      <input
        id={id}
        type={type}
        aria-describedby={hintId}
        className="type-body min-h-12 w-full min-w-0 rounded-control border border-text-muted bg-background px-4 text-text"
        {...rest}
      />
      {hint && (
        <p id={hintId} className="type-small text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
