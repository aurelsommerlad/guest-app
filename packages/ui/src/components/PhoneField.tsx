"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "../icons/Icon";
import { cx } from "../lib/cx";
import { FieldError, fieldControlClass, fieldDescription, fieldLabelClass } from "./TextField";

export type CallingCodeOption = {
  /** ISO 3166-1 alpha-2, e.g. "DE". */
  value: string;
  /** "+49" */
  code: string;
  /** Localised country name, e.g. "Deutschland". */
  name: string;
};

export type PhoneFieldProps = {
  id: string;
  /** Field name of the number; the calling code is sent as `countryName`. */
  name: string;
  countryName: string;
  label: string;
  /** Accessible label of the calling-code select, e.g. "Ländervorwahl". */
  countryLabel: string;
  options: readonly CallingCodeOption[];
  defaultCountry: string;
  defaultValue?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
};

/**
 * International phone number: calling code (native select, shows "+49" compactly) plus the
 * number. A number typed with "+" or "00" wins over the selected code. Normalisation and
 * validation happen on the server (E.164).
 */
export function PhoneField({
  id,
  name,
  countryName,
  label,
  countryLabel,
  options,
  defaultCountry,
  defaultValue,
  hint,
  error,
  required,
  autoComplete = "tel-national",
  className,
}: PhoneFieldProps) {
  // Uncontrolled select: survives React's automatic form reset after a server action.
  // The visible code follows the DOM value (also after a reset).
  const selectRef = useRef<HTMLSelectElement>(null);
  const [country, setCountry] = useState(defaultCountry);
  useEffect(() => {
    const select = selectRef.current;
    const form = select?.form;
    if (!select || !form) return;
    const sync = () => {
      setTimeout(() => {
        setCountry(select.value);
      });
    };
    form.addEventListener("reset", sync);
    return () => {
      form.removeEventListener("reset", sync);
    };
  }, []);
  const selected = options.find((option) => option.value === country);
  const { hintId, errorId, describedBy } = fieldDescription(id, hint, error);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="flex gap-2">
        <div
          className={cx(
            // Fixed width for the code (no w-full); the number takes the rest of the row.
            "type-body relative flex min-h-11 w-24 shrink-0 items-center justify-between gap-1 rounded-control border bg-surface-raised px-3 text-text",
            error ? "border-text" : "border-text-muted",
          )}
        >
          <span aria-hidden className="tabular-nums">
            {selected?.code ?? "+"}
          </span>
          <Icon name="chevron-down" size="sm" className="text-text-muted" />
          <select
            id={`${id}-country`}
            name={countryName}
            aria-label={countryLabel}
            ref={selectRef}
            defaultValue={defaultCountry}
            onChange={(event) => {
              setCountry(event.target.value);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.name} ({option.code})
              </option>
            ))}
          </select>
        </div>
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          required={required}
          maxLength={30}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(fieldControlClass, "flex-1", error ? "border-text" : "border-text-muted")}
        />
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && (
        <p id={hintId} className="type-caption text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
