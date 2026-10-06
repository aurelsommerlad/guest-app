import type { UploadGrant, UploadResult } from "../actions";

/** Same limits as the server (checked there again; these only give early feedback). */
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ImageUploadActions = {
  request: (file: { contentType: string; size: number }) => Promise<UploadGrant>;
  confirm: (input: { path: string; width: number; height: number }) => Promise<UploadResult>;
};

/**
 * Signed upload (ADR 0013): ask the server for a grant for one generated path, upload the
 * file directly to Storage with that grant, then let the server verify the stored file.
 * The browser never sees a Storage key and cannot choose the path.
 */
export async function uploadImageFile(
  file: File,
  actions: ImageUploadActions,
  measure: (file: File) => Promise<{ width: number; height: number }>,
  fetchFn: typeof fetch = fetch,
): Promise<UploadResult> {
  if (!TYPES.has(file.type)) return { ok: false, error: "Erlaubt sind JPG, PNG und WebP." };
  if (file.size === 0) return { ok: false, error: "Die Datei ist leer." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Das Bild ist größer als 8 MB." };

  const size = await measure(file);
  const grant = await actions.request({ contentType: file.type, size: file.size });
  if (!grant.ok) return grant;

  const response = await fetchFn(grant.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": file.type,
      "cache-control": "max-age=31536000",
      "x-upsert": "false",
    },
    body: file,
  });
  if (!response.ok) {
    return {
      ok: false,
      error:
        response.status === 413
          ? "Das Bild ist größer als 8 MB."
          : response.status === 415
            ? "Erlaubt sind JPG, PNG und WebP."
            : "Das Bild konnte nicht hochgeladen werden.",
    };
  }
  return actions.confirm({ path: grant.path, width: size.width, height: size.height });
}
