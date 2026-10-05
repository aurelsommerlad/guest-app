"use server";

import { GUIDE_STATUSES, type GuideStatus } from "@up/core";
import { redirect } from "next/navigation";

import { requireAdmin } from "../auth/server";
import { logger } from "../../server/logger";
import { MediaUploadError, uploadGuideImage } from "../../server/media-storage";
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
import { guideDeps, mediaStorageConfig } from "./server";

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

/** Image upload for the editor – the file goes through the server, never to Storage directly. */
export async function uploadImageAction(
  propertyId: string,
  formData: FormData,
): Promise<UploadResult> {
  const context = await tenant();
  const deps = guideDeps();
  const storage = mediaStorageConfig();
  if (!storage) return { ok: false, error: "Der Bild-Upload ist nicht konfiguriert." };
  const { getPropertyById } = await import("@up/db");
  if (!(await getPropertyById(deps.db, context, propertyId))) {
    return { ok: false, error: "Objekt nicht gefunden." };
  }
  const file = formData.get("file");
  const width = Number(field(formData, "width", 10));
  const height = Number(field(formData, "height", 10));
  if (
    !(file instanceof File) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return { ok: false, error: "Bitte eine Bilddatei (JPG, PNG oder WebP) auswählen." };
  }
  try {
    const src = await uploadGuideImage(
      storage,
      { tenantId: context.tenantId, propertyId },
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    );
    return {
      ok: true,
      image: { src, width: Math.min(width, 20_000), height: Math.min(height, 20_000) },
    };
  } catch (error) {
    const reason = error instanceof MediaUploadError ? error.reason : "storage-failed";
    logger.warn("guide image upload failed", { reason });
    const messages = {
      "too-large": "Das Bild ist größer als 8 MB.",
      "unsupported-type": "Erlaubt sind JPG, PNG und WebP.",
      empty: "Die Datei ist leer.",
      "storage-failed": "Das Bild konnte nicht gespeichert werden.",
    } as const;
    return { ok: false, error: messages[reason] };
  }
}
