"use client";

import { type CallingCodeOption, type SelectOption } from "@up/ui";
import { type ReactNode } from "react";

/** Editorial field: tracked small-caps label, underline input, hint or error below. */
function Frame({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`v2-field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="v2-field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="v2-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  hint?: string;
  error?: string;
  className?: string;
};

const describedBy = (id: string, error?: string, hint?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function V2TextField({
  type = "text",
  min,
  max,
  maxLength,
  inputMode,
  ...props
}: Common & {
  type?: "text" | "email" | "date";
  min?: string;
  max?: string;
  maxLength?: number;
  inputMode?: "email" | "text" | "numeric";
}) {
  const { id, name, label, required, autoComplete, defaultValue, hint, error, className } = props;
  return (
    <Frame
      id={id}
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      className={className}
    >
      <input
        id={id}
        name={name}
        type={type}
        className="v2-input"
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        min={min}
        max={max}
        maxLength={maxLength}
        inputMode={inputMode}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
      />
    </Frame>
  );
}

export function V2SelectField({
  options,
  placeholder,
  ...props
}: Common & { options: readonly SelectOption[]; placeholder: string }) {
  const { id, name, label, required, autoComplete, defaultValue, hint, error, className } = props;
  return (
    <Frame
      id={id}
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      className={className}
    >
      <select
        id={id}
        name={name}
        className="v2-input"
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Frame>
  );
}

/** Calling code + number – the same two form values as the current app's PhoneField. */
export function V2PhoneField({
  countryName,
  countryLabel,
  options,
  defaultCountry,
  ...props
}: Common & {
  countryName: string;
  countryLabel: string;
  options: readonly CallingCodeOption[];
  defaultCountry: string;
}) {
  const { id, name, label, required, autoComplete, defaultValue, hint, error, className } = props;
  return (
    <Frame
      id={id}
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      className={className}
    >
      <div className="v2-phone">
        <select
          name={countryName}
          aria-label={countryLabel}
          className="v2-input"
          defaultValue={defaultCountry}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              aria-label={`${option.name} ${option.code}`}
            >
              {option.value} {option.code}
            </option>
          ))}
        </select>
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          className="v2-input"
          required={required}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
        />
      </div>
    </Frame>
  );
}
