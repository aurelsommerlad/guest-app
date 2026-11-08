"use server";

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
): Promise<void> {
  const admin = await requireAdmin();
  const result = await decideRequest(
    operationsDeps(),
    admin,
    requestId,
    decision === "confirm" ? "confirm" : "decline",
  );
  const key = result.ok ? "notice" : "error";
  const text = result.ok ? result.message : result.error;
  redirect(`/requests/r/${encodeURIComponent(requestId)}?${key}=${encodeURIComponent(text)}`);
}
