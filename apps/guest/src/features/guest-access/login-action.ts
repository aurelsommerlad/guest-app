"use server";

import { cookies, headers } from "next/headers";

import { serverEnv } from "../../env/server";
import { redirect } from "../../i18n/navigation";
import { type Locale } from "../../i18n/routing";
import { loginPms } from "../../server/pms";
import { loginWithBookingReference, type LoginOutcome } from "./guest-access-service";
import { clientAddressFrom } from "./rate-limit";
import { getGuestAccessDeps, guestSessionCookie } from "./server";
import { sessionCookieAttributes } from "./session-cookie";

export type LoginFormState =
  | { status: "idle" }
  | {
      status: "not-found" | "rate-limited";
      retryAfterMinutes?: number;
      bookingReference: string;
      lastName: string;
    };

function textField(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/**
 * Booking number + last name login. Inputs travel only in the POST body, are never
 * logged and are not stored; on success only the guest session remains.
 */
export async function loginAction(
  locale: Locale,
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const bookingReference = textField(formData, "bookingReference", 100);
  const lastName = textField(formData, "lastName", 200);

  const cookieStore = await cookies();
  const deps = getGuestAccessDeps();
  const outcome: LoginOutcome = deps
    ? await loginWithBookingReference(
        { ...deps, pms: loginPms() },
        {
          tenantSlug: serverEnv.GUEST_TENANT_SLUG,
          bookingReference,
          lastName,
          clientAddress: clientAddressFrom(await headers()),
        },
        cookieStore.get(guestSessionCookie.name)?.value,
      )
    : { ok: false, reason: "not-found" };

  if (outcome.ok) {
    cookieStore.set(
      guestSessionCookie.name,
      outcome.session.secret,
      sessionCookieAttributes(guestSessionCookie, outcome.session.expiresAt, new Date()),
    );
    return redirect({ href: "/stay", locale });
  }

  return outcome.reason === "rate-limited"
    ? {
        status: "rate-limited",
        retryAfterMinutes: Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60)),
        bookingReference,
        lastName,
      }
    : { status: "not-found", bookingReference, lastName };
}
