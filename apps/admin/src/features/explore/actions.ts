"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
import type { UploadGrant, UploadResult } from "../guide/actions";
import { confirmMediaUpload, requestMediaUpload } from "../media/media-upload-service";
import {
  changePlaceStatus,
  createPlace,
  deletePlace,
  movePlace,
  updatePlace,
} from "./explore-admin-service";
import { explorePath, placePath } from "./paths";
import { exploreDeps, exploreMediaDeps, exploreScope } from "./server";

export type ExploreFormState =
  | { status: "idle" }
  | { status: "saved" | "error"; message: string }
  | { status: "created"; url: string };

function field(formData: FormData, name: string, max = 6000): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Context of the current view: a property id from the URL or null (Alle Objekte). */
function contextProperty(value: string | null): string | null {
  return value && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : null;
}

function propertyIds(formData: FormData): string[] {
  return formData
    .getAll("propertyIds")
    .filter((value): value is string => typeof value === "string")
    .slice(0, 100);
}

export async function createPlaceAction(
  viewProperty: string | null,
  _previous: ExploreFormState,
  formData: FormData,
): Promise<ExploreFormState> {
  const admin = await requireAdmin();
  const result = await createPlace(
    exploreDeps(),
    { tenantId: admin.tenantId },
    {
      titleDe: field(formData, "titleDe", 200),
      titleEn: field(formData, "titleEn", 200),
      teaserDe: field(formData, "teaserDe", 400),
      teaserEn: field(formData, "teaserEn", 400),
      category: field(formData, "category", 40),
      propertyIds: propertyIds(formData),
    },
  );
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", url: placePath(contextProperty(viewProperty), result.id) };
}

export async function savePlaceAction(
  placeId: string,
  _previous: ExploreFormState,
  formData: FormData,
): Promise<ExploreFormState> {
  const admin = await requireAdmin();
  const result = await updatePlace(exploreDeps(), { tenantId: admin.tenantId }, placeId, {
    titleDe: field(formData, "titleDe", 200),
    titleEn: field(formData, "titleEn", 200),
    slugDe: field(formData, "slugDe", 120),
    slugEn: field(formData, "slugEn", 120),
    category: field(formData, "category", 40),
    teaserDe: field(formData, "teaserDe", 400),
    teaserEn: field(formData, "teaserEn", 400),
    descriptionDe: field(formData, "descriptionDe", 8000),
    descriptionEn: field(formData, "descriptionEn", 8000),
    tipDe: field(formData, "tipDe", 2000),
    tipEn: field(formData, "tipEn", 2000),
    openingHoursDe: field(formData, "openingHoursDe", 800),
    openingHoursEn: field(formData, "openingHoursEn", 800),
    heroImage: field(formData, "heroImage", 10_000),
    address: field(formData, "address", 600),
    locality: field(formData, "locality", 200),
    mapsUrl: field(formData, "mapsUrl", 2100),
    websiteUrl: field(formData, "websiteUrl", 2100),
    phone: field(formData, "phone", 80),
    reservationUrl: field(formData, "reservationUrl", 2100),
    featured: formData.get("featured") === "on",
    propertyIds: propertyIds(formData),
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "saved", message: "Gespeichert." };
}

export async function changePlaceStatusAction(
  placeId: string,
  status: string,
  viewProperty: string | null,
): Promise<void> {
  const admin = await requireAdmin();
  const result = await changePlaceStatus(
    exploreDeps(),
    { tenantId: admin.tenantId },
    placeId,
    status,
  );
  const view = contextProperty(viewProperty);
  if (!result.ok) redirect(explorePath(view));
  redirect(placePath(view, placeId));
}

export async function deletePlaceAction(
  placeId: string,
  viewProperty: string | null,
): Promise<void> {
  const admin = await requireAdmin();
  const view = contextProperty(viewProperty);
  const result = await deletePlace(exploreDeps(), { tenantId: admin.tenantId }, placeId);
  redirect(
    result.ok
      ? explorePath(view)
      : `${placePath(view, placeId)}?error=${encodeURIComponent(result.error)}`,
  );
}

export async function movePlaceAction(
  placeId: string,
  direction: "up" | "down",
  viewProperty: string | null,
): Promise<void> {
  const admin = await requireAdmin();
  const view = contextProperty(viewProperty);
  await movePlace(
    exploreDeps(),
    { tenantId: admin.tenantId },
    placeId,
    direction === "up" ? "up" : "down",
    view,
  );
  redirect(explorePath(view));
}

const UPLOAD_NOT_CONFIGURED = {
  ok: false,
  error: "Der Bild-Upload ist nicht konfiguriert.",
} as const;

/** Title image, step 1: signed upload for one generated path under <tenant>/explore/. */
export async function requestPlaceImageUploadAction(file: {
  contentType: string;
  size: number;
}): Promise<UploadGrant> {
  const admin = await requireAdmin();
  const deps = exploreMediaDeps();
  if (!deps) return UPLOAD_NOT_CONFIGURED;
  return requestMediaUpload(deps, admin, exploreScope(admin.tenantId), {
    contentType: (file as { contentType?: unknown }).contentType,
    size: (file as { size?: unknown }).size,
  });
}

/** Title image, step 3: the stored file is verified before the editor may use it. */
export async function confirmPlaceImageUploadAction(input: {
  path: string;
  width: number;
  height: number;
}): Promise<UploadResult> {
  const admin = await requireAdmin();
  const deps = exploreMediaDeps();
  if (!deps) return UPLOAD_NOT_CONFIGURED;
  return confirmMediaUpload(deps, admin, exploreScope(admin.tenantId), {
    path: (input as { path?: unknown }).path,
    width: (input as { width?: unknown }).width,
    height: (input as { height?: unknown }).height,
  });
}
