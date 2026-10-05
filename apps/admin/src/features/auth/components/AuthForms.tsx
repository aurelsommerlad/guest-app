"use client";

import { Button } from "@up/ui";
import { useActionState } from "react";

import { Field, FormMessage, Input } from "../../../components/fields";
import { type AuthFormState, loginAction, setupAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(loginAction, {
    status: "idle",
  });
  return (
    <form action={action} className="flex flex-col gap-5">
      <Field label="E-Mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Passwort" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Anmelden …" : "Anmelden"}
      </Button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(setupAction, {
    status: "idle",
  });
  return (
    <form action={action} className="flex flex-col gap-5">
      <Field
        label="Einrichtungsschlüssel"
        htmlFor="setupToken"
        hint="Wert von ADMIN_SETUP_TOKEN aus der Server-Konfiguration."
      >
        <Input id="setupToken" name="setupToken" type="password" autoComplete="off" required />
      </Field>
      <Field label="Mandant" htmlFor="tenantSlug" hint="Slug des Mandanten in der Datenbank.">
        <Input id="tenantSlug" name="tenantSlug" autoComplete="off" required />
      </Field>
      <Field label="E-Mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Passwort" htmlFor="password" hint="Mindestens 12 Zeichen.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      <Field label="Passwort wiederholen" htmlFor="passwordRepeat">
        <Input
          id="passwordRepeat"
          name="passwordRepeat"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Konto anlegen
      </Button>
    </form>
  );
}
