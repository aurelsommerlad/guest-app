import { type ComponentPropsWithoutRef } from "react";

import { Icon } from "../icons/Icon";
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

/** Shared control look: chalk fill, 44 px touch height, hairline-strong border. */
export const fieldControlClass =
  "type-body min-h-11 w-full min-w-0 rounded-control border bg-surface-raised px-3.5 text-text";

export const fieldLabelClass = "type-small text-text";

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
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={fieldLabelClass}>
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
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && (
        <p id={hintId} className="type-small text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Inline validation message right below its field. */
export function FieldError({ id, children }: { id: string | undefined; children: string }) {
  return (
    <p id={id} className="type-caption flex items-start gap-1.5 text-text">
      <Icon name="info" size="sm" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}
