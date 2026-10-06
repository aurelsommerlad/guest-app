"use client";

import { Button, cx } from "@up/ui";
import { useRef, useState } from "react";

import { Input, LocalizedPair } from "../../components/fields";
import { type ImageUploadActions, uploadImageFile } from "../guide/components/image-upload";
import { type EditorImage, emptyTexts } from "../guide/components/content-types";

function measure(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error("not an image"));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Title image with signed direct upload, preview and alt text (DE/EN). */
export function ImageEditor({
  label,
  image,
  onChange,
  uploadActions,
  uploadEnabled,
}: {
  label: string;
  image: EditorImage | undefined;
  onChange: (image: EditorImage | undefined) => void;
  uploadActions: ImageUploadActions;
  uploadEnabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await uploadImageFile(file, uploadActions, measure);
      if (result.ok) onChange({ ...result.image, alt: image?.alt ?? emptyTexts() });
      else setMessage(result.error);
    } catch {
      setMessage("Bitte eine Bilddatei (JPG, PNG oder WebP) auswählen.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="type-eyebrow pb-1.5 text-text">{label}</legend>
      {image && (
        // Admin preview of an uploaded image (any allowed origin, no optimisation needed).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.src} alt="" className="max-h-48 w-auto self-start rounded-card" />
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id={`${label}-file`}
          disabled={!uploadEnabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <label
          htmlFor={`${label}-file`}
          className={cx(
            "type-small inline-flex min-h-11 cursor-pointer items-center rounded-control border border-border px-4 text-text hover:bg-surface",
            (!uploadEnabled || busy) && "pointer-events-none opacity-40",
          )}
        >
          {busy ? "Wird hochgeladen …" : image ? "Bild ersetzen" : "Bild hochladen"}
        </label>
        {image && (
          <Button
            variant="secondary"
            onClick={() => {
              onChange(undefined);
            }}
          >
            Bild entfernen
          </Button>
        )}
      </div>
      {!uploadEnabled && (
        <p className="type-caption text-text-muted">
          Der Bild-Upload ist in dieser Umgebung nicht konfiguriert.
        </p>
      )}
      {message && (
        <p role="status" className="type-small text-text">
          {message}
        </p>
      )}
      {image && (
        <LocalizedPair label="Bildbeschreibung (Alternativtext)">
          <Input
            aria-label="Bildbeschreibung Deutsch"
            value={image.alt.de}
            onChange={(event) => {
              onChange({ ...image, alt: { ...image.alt, de: event.target.value } });
            }}
          />
          <Input
            aria-label="Bildbeschreibung Englisch"
            placeholder="English"
            value={image.alt.en}
            onChange={(event) => {
              onChange({ ...image, alt: { ...image.alt, en: event.target.value } });
            }}
          />
        </LocalizedPair>
      )}
    </fieldset>
  );
}
