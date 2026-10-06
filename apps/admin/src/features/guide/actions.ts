"use server";

import { GUIDE_STATUSES, type GuideStatus } from "@up/core";
import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
import {
  changeStatus,
  createOverride,
  createTopic,
  deleteEntry,
  loadGuideEntry,
  moveTopic,
  updateContent,
  updateTopic,
} from "./guide-admin-service";
import { confirmImageUpload, requestImageUpload } from "./guide-media-service";
import { guideDeps, guideMediaDeps } from "./server";

// Admin pages are dynamic (session cookie): every navigation renders fresh data, so no
// revalidatePath is needed – it would only trigger extra re-renders of open editors.
export type GuideFormState =
  | { status: "idle" }
  | { status: "saved" | "error"; message: string }
  /** Created – the client navigates once to `url` (no server redirect, no double render). */
  | { status: "created"; url: string };

function field(formData: FormData, name: string, max = 5000): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

async function tenant() {
  const admin = await requireAdmin();
  return { tenantId: admin.tenantId };
}

const guidePath = (propertyId: string) => `/properties/${propertyId}/guide`;

export async function createTopicAction(
  propertyId: string,
  _previous: GuideFormState,
  formData: FormData,
): Promise<GuideFormState> {
  const context = await tenant();
  const scope = field(formData, "scope") === "unit" ? "unit" : "property";
  const result = await createTopic(guideDeps(), context, propertyId, {
    titleDe: field(formData, "titleDe", 120),
    titleEn: field(formData, "titleEn", 120),
    shortDescriptionDe: field(formData, "shortDescriptionDe", 200),
    shortDescriptionEn: field(formData, "shortDescriptionEn", 200),
    icon: field(formData, "icon", 40),
    scope,
    ...(scope === "unit" ? { unitId: field(formData, "unitId", 64) } : {}),
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", url: `${guidePath(propertyId)}/${result.id}` };
}

export async function updateTopicAction(
  entryId: string,
  _previous: GuideFormState,
  formData: FormData,
): Promise<GuideFormState> {
  const context = await tenant();
  const result = await updateTopic(guideDeps(), context, entryId, {
    titleDe: field(formData, "titleDe", 120),
    titleEn: field(formData, "titleEn", 120),
    shortDescriptionDe: field(formData, "shortDescriptionDe", 200),
    shortDescriptionEn: field(formData, "shortDescriptionEn", 200),
    eyebrowDe: field(formData, "eyebrowDe", 60),
    eyebrowEn: field(formData, "eyebrowEn", 60),
    slugDe: field(formData, "slugDe", 80),
    slugEn: field(formData, "slugEn", 80),
    icon: field(formData, "icon", 40),
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "saved", message: "Gespeichert." };
}

export async function saveContentAction(
  entryId: string,
  _previous: GuideFormState,
  formData: FormData,
): Promise<GuideFormState> {
  const context = await tenant();
  const result = await updateContent(
    guideDeps(),
    context,
    entryId,
    field(formData, "content", 500_000),
  );
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "saved", message: "Gespeichert." };
}

export async function createOverrideAction(
  topicId: string,
  _previous: GuideFormState,
  formData: FormData,
): Promise<GuideFormState> {
  const context = await tenant();
  const deps = guideDeps();
  const loaded = await loadGuideEntry(deps, context, topicId);
  if (!loaded) return { status: "error", message: "Thema nicht gefunden." };
  const result = await createOverride(deps, context, topicId, field(formData, "unitId", 64));
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", url: `${guidePath(loaded.property.id)}/${result.id}` };
}

export async function changeStatusAction(entryId: string, status: GuideStatus): Promise<void> {
  if (!(GUIDE_STATUSES as readonly string[]).includes(status)) return;
  const context = await tenant();
  const deps = guideDeps();
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded) redirect("/properties");
  await changeStatus(deps, context, entryId, status);
  redirect(`${guidePath(loaded.property.id)}/${entryId}`);
}

export async function moveTopicAction(entryId: string, direction: "up" | "down"): Promise<void> {
  const context = await tenant();
  const deps = guideDeps();
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded) redirect("/properties");
  await moveTopic(deps, context, entryId, direction === "up" ? "up" : "down");
  redirect(guidePath(loaded.property.id));
}

export async function deleteEntryAction(entryId: string): Promise<void> {
  const context = await tenant();
  const result = await deleteEntry(guideDeps(), context, entryId);
  if (!result.ok) {
    const loaded = await loadGuideEntry(guideDeps(), context, entryId);
    redirect(
      loaded
        ? `${guidePath(loaded.property.id)}/${entryId}?error=${encodeURIComponent(result.error)}`
        : "/properties",
    );
  }
  redirect(
    result.topicId
      ? `${guidePath(result.propertyId)}/${result.topicId}`
      : guidePath(result.propertyId),
  );
}

export type UploadResult =
  | { ok: true; image: { src: string; width: number; height: number } }
  | { ok: false; error: string };

export type UploadGrant =
  { ok: true; uploadUrl: string; path: string } | { ok: false; error: string };

const UPLOAD_NOT_CONFIGURED = {
  ok: false,
  error: "Der Bild-Upload ist nicht konfiguriert.",
} as const;

/**
 * Image upload, step 1: the server checks session, property, type and size and returns a
 * signed upload for one generated path. The browser then uploads directly to Storage.
 */
export async function requestImageUploadAction(
  propertyId: string,
  file: { contentType: string; size: number },
): Promise<UploadGrant> {
  const admin = await requireAdmin();
  const deps = guideMediaDeps();
  if (!deps) return UPLOAD_NOT_CONFIGURED;
  return requestImageUpload(deps, admin, propertyId, {
    contentType: (file as { contentType?: unknown }).contentType,
    size: (file as { size?: unknown }).size,
  });
}

/** Image upload, step 3: the stored file is verified before the editor may use it. */
export async function confirmImageUploadAction(
  propertyId: string,
  input: { path: string; width: number; height: number },
): Promise<UploadResult> {
  const admin = await requireAdmin();
  const deps = guideMediaDeps();
  if (!deps) return UPLOAD_NOT_CONFIGURED;
  return confirmImageUpload(deps, admin, propertyId, {
    path: (input as { path?: unknown }).path,
    width: (input as { width?: unknown }).width,
    height: (input as { height?: unknown }).height,
  });
}
