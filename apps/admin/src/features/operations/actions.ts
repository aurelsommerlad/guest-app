"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
import { decideRequest, saveExtensionSettings } from "./operations-service";
import { operationsDeps } from "./server";

export type SettingsFormState = { status: "idle" } | { status: "saved" | "error"; message: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export async function saveExtensionSettingsAction(
  propertyId: string,
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const admin = await requireAdmin();
  const result = await saveExtensionSettings(operationsDeps(), admin, propertyId, {
    extensionNightEnabled: formData.get("extensionNightEnabled") === "on",
    discountPreArrivalOneNightGap: field(formData, "discountPreArrivalOneNightGap"),
    discountPreArrivalStandard: field(formData, "discountPreArrivalStandard"),
    discountInHouseOneNightGap: field(formData, "discountInHouseOneNightGap"),
    discountInHouseStandard: field(formData, "discountInHouseStandard"),
    minSellableStayNights: field(formData, "minSellableStayNights"),
  });
  return result.ok
    ? { status: "saved", message: "Gespeichert." }
    : { status: "error", message: result.error };
}

export async function decideRequestAction(
  requestId: string,
  decision: "confirm" | "decline",
  formData?: FormData,
): Promise<void> {
  const admin = await requireAdmin();
  const accepted = formData?.get("acceptedPriceCents");
  const reason = formData?.get("reason");
  const result = await decideRequest(
    operationsDeps(),
    admin,
    requestId,
    decision === "confirm" ? "confirm" : "decline",
    {
      ...(typeof accepted === "string" && /^\d{1,9}$/.test(accepted)
        ? { acceptedPriceCents: Number(accepted) }
        : {}),
      ...(typeof reason === "string" ? { reason: reason.slice(0, 600) } : {}),
    },
  );
  const key = result.ok ? "notice" : "error";
  const text = result.ok ? result.message : result.error;
  // The open-request counter lives in the shared layout.
  if (result.ok) revalidatePath("/", "layout");
  redirect(`/requests/r/${encodeURIComponent(requestId)}?${key}=${encodeURIComponent(text)}`);
}
