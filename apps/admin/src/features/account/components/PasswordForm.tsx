"use client";

import { PASSWORD_MIN_LENGTH } from "@up/core";
import { Button } from "@up/ui";
import { useActionState } from "react";

import { Field, FormMessage, Input } from "../../../components/fields";
import { changePasswordAction, type PasswordFormState } from "../actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordFormState, FormData>(
    changePasswordAction,
    { status: "idle" },
  );
  return (
    <form action={action} className="flex max-w-120 flex-col gap-5">
      <Field label="Aktuelles Passwort" htmlFor="current">
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field
        label="Neues Passwort"
        htmlFor="next"
        hint={`Mindestens ${String(PASSWORD_MIN_LENGTH)} Zeichen. Andere Anmeldungen werden danach beendet.`}
      >
        <Input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </Field>
      <Field label="Neues Passwort wiederholen" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </Field>
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          Passwort ändern
        </Button>
      </div>
    </form>
  );
}
