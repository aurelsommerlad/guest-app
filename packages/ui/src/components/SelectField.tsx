import { type ComponentPropsWithoutRef } from "react";

import { Icon } from "../icons/Icon";
import { cx } from "../lib/cx";
import { FieldError, fieldControlClass, fieldDescription, fieldLabelClass } from "./TextField";

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = {
  label: string;
  hint?: string;
  error?: string;
  id: string;
  options: readonly SelectOption[];
  /** Text of the empty first option (e.g. "Bitte wählen"). */
  placeholder?: string;
} & Omit<ComponentPropsWithoutRef<"select">, "id" | "children">;

/** Native select with the TextField look – native for best mobile and screen reader support. */
export function SelectField({
  label,
  hint,
  error,
  id,
  options,
  placeholder,
  className,
  ...rest
}: SelectFieldProps) {
  const { hintId, errorId, describedBy } = fieldDescription(id, hint, error);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(
            fieldControlClass,
            "appearance-none pr-10",
            error ? "border-text" : "border-text-muted",
          )}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          size="sm"
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-muted"
        />
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && (
        <p id={hintId} className="type-small text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
