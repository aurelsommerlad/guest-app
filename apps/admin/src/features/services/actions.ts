"use server";

import { redirect } from "next/navigation";

import { FORBIDDEN_MESSAGE, isAllowed } from "../auth/authorization";
import { requireAdmin } from "../auth/server";
import type { UploadGrant, UploadResult } from "../guide/actions";
import { confirmMediaUpload, requestMediaUpload } from "../media/media-upload-service";
import {
  changeOfferStatus,
  createOffer,
  type OfferForm,
  type PropertyConfigForm,
  removeConfig,
  saveConfig,
  updateOffer,
} from "./catalog-service";
import { catalogDeps, offersMediaDeps, offersScope } from "./server";
import { SERVICE_CONFIG_ISSUE_LABELS } from "@up/core";

export type ServiceFormState =
  | { status: "idle" }
  | { status: "saved" | "error"; message: string; issues?: string[] }
  | { status: "created"; url: string };

function field(formData: FormData, name: string, max = 5000): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

function offerForm(formData: FormData): OfferForm {
  return {
    titleDe: field(formData, "titleDe", 200),
    titleEn: field(formData, "titleEn", 200),
    teaserDe: field(formData, "teaserDe", 400),
    teaserEn: field(formData, "teaserEn", 400),
    bodyDe: field(formData, "bodyDe", 5000),
    bodyEn: field(formData, "bodyEn", 5000),
    detailsDe: field(formData, "detailsDe", 600),
    detailsEn: field(formData, "detailsEn", 600),
    category: field(formData, "category", 40),
    fulfillment: field(formData, "fulfillment", 20),
    cancellation: field(formData, "cancellation", 20),
    cancellationHours: field(formData, "cancellationHours", 5),
    heroImage: field(formData, "heroImage", 4000),
  };
}

const offerPath = (offerId: string) => `/services/offers/${encodeURIComponent(offerId)}`;

export async function createOfferAction(
  _previous: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const admin = await requireAdmin();
  const result = await createOffer(catalogDeps(), admin, offerForm(formData));
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", url: offerPath(result.id) };
}

export async function updateOfferAction(
  offerId: string,
  _previous: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const admin = await requireAdmin();
  const result = await updateOffer(catalogDeps(), admin, offerId, offerForm(formData));
  return result.ok
    ? { status: "saved", message: "Gespeichert." }
    : { status: "error", message: result.error };
}

export async function changeOfferStatusAction(offerId: string, status: string): Promise<void> {
  const admin = await requireAdmin();
  const result = await changeOfferStatus(catalogDeps(), admin, offerId, status);
  redirect(
    result.ok
      ? offerPath(offerId)
      : `${offerPath(offerId)}?error=${encodeURIComponent(result.error)}`,
  );
}

function configForm(formData: FormData): PropertyConfigForm {
  const flag = (name: string) => formData.get(name) === "on";
  return {
    extrasServiceId: field(formData, "extrasServiceId", 130),
    active: flag("active"),
    sortOrder: field(formData, "sortOrder", 16),
    actionType: field(formData, "actionType", 30),
    bookingRule: field(formData, "bookingRule", 30),
    fulfillment: field(formData, "fulfillment", 20),
    extraPersonPrice: field(formData, "extraPersonPrice", 20),
    priceUnitLabelDe: field(formData, "priceUnitLabelDe", 100),
    priceUnitLabelEn: field(formData, "priceUnitLabelEn", 100),
    requiresRemainingCapacity: flag("requiresRemainingCapacity"),
    requiresVehicleRegistration: flag("requiresVehicleRegistration"),
    maxOnePerReservation: flag("maxOnePerReservation"),
    allowedUnitGroupIds: [
      ...formData
        .getAll("allowedUnitGroupIds")
        .filter((value): value is string => typeof value === "string"),
      ...field(formData, "allowedUnitGroupIdsText", 4000).split(","),
    ].slice(0, 60),
    titleOverrideDe: field(formData, "titleOverrideDe", 200),
    titleOverrideEn: field(formData, "titleOverrideEn", 200),
    teaserOverrideDe: field(formData, "teaserOverrideDe", 400),
    teaserOverrideEn: field(formData, "teaserOverrideEn", 400),
    // The checkbox exists only while Extras' text logic is active (marker field).
    ...(formData.get("extrasTextsShown") === "1"
      ? { extrasTextsActive: flag("extrasTextsActive") }
      : {}),
  };
}

export async function saveConfigAction(
  offerId: string,
  propertyId: string,
  _previous: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const admin = await requireAdmin();
  const result = await saveConfig(catalogDeps(), admin, offerId, propertyId, configForm(formData));
  if (!result.ok) return { status: "error", message: result.error };
  if (result.created)
    return { status: "created", url: `${offerPath(offerId)}/${encodeURIComponent(propertyId)}` };
  return {
    status: "saved",
    message: result.issues.length
      ? "Gespeichert – mit Konfigurationsfehlern. Der Service ist an diesem Objekt nicht buchbar, bis sie behoben sind."
      : "Gespeichert.",
    issues: result.issues.map((issue) => SERVICE_CONFIG_ISSUE_LABELS[issue]),
  };
}

export async function removeConfigAction(offerId: string, propertyId: string): Promise<void> {
  const admin = await requireAdmin();
  const result = await removeConfig(catalogDeps(), admin, offerId, propertyId);
  redirect(
    result.ok
      ? offerPath(offerId)
      : `${offerPath(offerId)}?error=${encodeURIComponent(result.error)}`,
  );
}

const UPLOAD_NOT_CONFIGURED = {
  ok: false,
  error: "Der Bild-Upload ist nicht konfiguriert.",
} as const;

export async function requestOfferImageUploadAction(file: {
  contentType: string;
  size: number;
}): Promise<UploadGrant> {
  const admin = await requireAdmin();
  if (!isAllowed(admin, "catalog.edit")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const deps = offersMediaDeps();
  if (!deps) return UPLOAD_NOT_CONFIGURED;
  return requestMediaUpload(deps, admin, offersScope(admin.tenantId), {
    contentType: (file as { contentType?: unknown }).contentType,
    size: (file as { size?: unknown }).size,
  });
}

export async function confirmOfferImageUploadAction(input: {
  path: string;
  width: number;
  height: number;
}): Promise<UploadResult> {
  const admin = await requireAdmin();
  if (!isAllowed(admin, "catalog.edit")) return { ok: false, error: FORBIDDEN_MESSAGE };
  const deps = offersMediaDeps();
  if (!deps) return UPLOAD_NOT_CONFIGURED;
  return confirmMediaUpload(deps, admin, offersScope(admin.tenantId), {
    path: (input as { path?: unknown }).path,
    width: (input as { width?: unknown }).width,
    height: (input as { height?: unknown }).height,
  });
}
