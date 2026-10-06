"use client";

import { Button, cx } from "@up/ui";
import { type ReactNode, useActionState, useRef, useState } from "react";

import {
  Field,
  FormMessage,
  Input,
  LocalizedPair,
  Select,
  TextArea,
} from "../../../components/fields";
import { type GuideFormState } from "../actions";
import { fromEditorContent } from "./content-mapping";
import { type ImageUploadActions, uploadImageFile } from "./image-upload";
import {
  BLOCK_TYPES,
  type EditorBlock,
  type EditorContent,
  type EditorImage,
  emptyTexts,
  newBlock,
  type Texts,
} from "./content-types";

type Props = {
  initial: EditorContent;
  saveAction: (previous: GuideFormState, formData: FormData) => Promise<GuideFormState>;
  uploadActions: ImageUploadActions;
  uploadEnabled: boolean;
};

/**
 * Structured content editor: intro, hero image and an ordered list of blocks – no HTML.
 * Block editors are looked up by type, so specialised editors can be added per type later.
 */
export function ContentEditor({ initial, saveAction, uploadActions, uploadEnabled }: Props) {
  const [content, setContent] = useState(initial);
  const [nextType, setNextType] = useState<EditorBlock["type"]>("paragraph");
  const [state, formAction, pending] = useActionState(saveAction, { status: "idle" });

  const setBlock = (index: number, block: EditorBlock) => {
    setContent((current) => ({
      ...current,
      blocks: current.blocks.map((item, i) => (i === index ? block : item)),
    }));
  };
  const moveBlock = (index: number, offset: -1 | 1) => {
    setContent((current) => {
      const blocks = [...current.blocks];
      const target = index + offset;
      if (target < 0 || target >= blocks.length) return current;
      const [moved] = blocks.splice(index, 1);
      if (moved) blocks.splice(target, 0, moved);
      return { ...current, blocks };
    });
  };
  const removeBlock = (index: number) => {
    setContent((current) => ({ ...current, blocks: current.blocks.filter((_, i) => i !== index) }));
  };

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="content" value={JSON.stringify(fromEditorContent(content))} />

      <LocalizedPair label="Einleitung (optional)">
        <TextArea
          aria-label="Einleitung Deutsch"
          value={content.intro.de}
          onChange={(event) => {
            setContent({ ...content, intro: { ...content.intro, de: event.target.value } });
          }}
        />
        <TextArea
          aria-label="Einleitung Englisch"
          placeholder="English"
          value={content.intro.en}
          onChange={(event) => {
            setContent({ ...content, intro: { ...content.intro, en: event.target.value } });
          }}
        />
      </LocalizedPair>

      <ImageEditor
        label="Titelbild (optional)"
        image={content.heroImage}
        onChange={(heroImage) => {
          setContent({ ...content, heroImage });
        }}
        uploadActions={uploadActions}
        uploadEnabled={uploadEnabled}
      />

      <section aria-label="Inhaltsblöcke" className="flex flex-col gap-4">
        <h3 className="type-eyebrow text-text">Inhalt</h3>
        {content.blocks.length === 0 && (
          <p className="type-small text-text-muted">Noch keine Blöcke.</p>
        )}
        {content.blocks.map((block, index) => (
          <article key={block.id} className="flex flex-col gap-4 rounded-card bg-surface p-4">
            <header className="flex items-center justify-between gap-3">
              <p className="type-caption text-text-muted">
                {BLOCK_TYPES.find((item) => item.type === block.type)?.label}
              </p>
              <div className="flex gap-1">
                <SmallButton
                  label="Nach oben"
                  onClick={() => {
                    moveBlock(index, -1);
                  }}
                  disabled={index === 0}
                >
                  ↑
                </SmallButton>
                <SmallButton
                  label="Nach unten"
                  onClick={() => {
                    moveBlock(index, 1);
                  }}
                  disabled={index === content.blocks.length - 1}
                >
                  ↓
                </SmallButton>
                <SmallButton
                  label="Block entfernen"
                  onClick={() => {
                    removeBlock(index);
                  }}
                >
                  Entfernen
                </SmallButton>
              </div>
            </header>
            <BlockEditor
              block={block}
              onChange={(changed) => {
                setBlock(index, changed);
              }}
              uploadActions={uploadActions}
              uploadEnabled={uploadEnabled}
            />
          </article>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Block hinzufügen" htmlFor="new-block-type">
            <Select
              id="new-block-type"
              value={nextType}
              onChange={(event) => {
                setNextType(event.target.value as EditorBlock["type"]);
              }}
            >
              {BLOCK_TYPES.map((item) => (
                <option key={item.type} value={item.type}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              setContent({ ...content, blocks: [...content.blocks, newBlock(nextType)] });
            }}
          >
            Hinzufügen
          </Button>
        </div>
      </section>

      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Speichern …" : "Inhalt speichern"}
      </Button>
    </form>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="type-caption min-h-9 min-w-9 rounded-control px-2 text-text hover:bg-background disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function TextsInputs({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: Texts;
  onChange: (value: Texts) => void;
  multiline?: boolean;
}) {
  const Control = multiline ? TextArea : Input;
  return (
    <LocalizedPair label={label}>
      <Control
        aria-label={`${label} Deutsch`}
        value={value.de}
        onChange={(event) => {
          onChange({ ...value, de: event.target.value });
        }}
      />
      <Control
        aria-label={`${label} Englisch`}
        placeholder="English"
        value={value.en}
        onChange={(event) => {
          onChange({ ...value, en: event.target.value });
        }}
      />
    </LocalizedPair>
  );
}

type BlockEditorProps = {
  block: EditorBlock;
  onChange: (block: EditorBlock) => void;
  uploadActions: Props["uploadActions"];
  uploadEnabled: boolean;
};

function BlockEditor({ block, onChange, uploadActions, uploadEnabled }: BlockEditorProps) {
  switch (block.type) {
    case "heading":
      return (
        <TextsInputs
          label="Überschrift"
          value={block.text}
          onChange={(text) => {
            onChange({ ...block, text });
          }}
        />
      );
    case "paragraph":
      return (
        <TextsInputs
          label="Text"
          multiline
          value={block.text}
          onChange={(text) => {
            onChange({ ...block, text });
          }}
        />
      );
    case "callout":
      return (
        <>
          <TextsInputs
            label="Titel (optional)"
            value={block.title}
            onChange={(title) => {
              onChange({ ...block, title });
            }}
          />
          <TextsInputs
            label="Hinweis"
            multiline
            value={block.text}
            onChange={(text) => {
              onChange({ ...block, text });
            }}
          />
        </>
      );
    case "link":
      return (
        <>
          <TextsInputs
            label="Beschriftung"
            value={block.label}
            onChange={(label) => {
              onChange({ ...block, label });
            }}
          />
          <Field label="Adresse (https://…)" htmlFor={`${block.id}-href`}>
            <Input
              id={`${block.id}-href`}
              type="url"
              value={block.href}
              onChange={(event) => {
                onChange({ ...block, href: event.target.value });
              }}
            />
          </Field>
        </>
      );
    case "list":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Darstellung" htmlFor={`${block.id}-style`}>
            <Select
              id={`${block.id}-style`}
              value={block.style}
              onChange={(event) => {
                onChange({ ...block, style: event.target.value === "steps" ? "steps" : "bullet" });
              }}
            >
              <option value="bullet">Aufzählung</option>
              <option value="steps">Schritte</option>
            </Select>
          </Field>
          {block.items.map((item, index) => (
            <div key={index} className="flex flex-col gap-2">
              <TextsInputs
                label={`Punkt ${index + 1}`}
                value={item}
                onChange={(changed) => {
                  onChange({
                    ...block,
                    items: block.items.map((current, i) => (i === index ? changed : current)),
                  });
                }}
              />
              {block.items.length > 1 && (
                <SmallButton
                  label={`Punkt ${index + 1} entfernen`}
                  onClick={() => {
                    onChange({ ...block, items: block.items.filter((_, i) => i !== index) });
                  }}
                >
                  Punkt entfernen
                </SmallButton>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              onChange({ ...block, items: [...block.items, emptyTexts()] });
            }}
          >
            Punkt hinzufügen
          </Button>
        </div>
      );
    case "image":
      return (
        <>
          <ImageEditor
            label="Bild"
            image={block.image}
            onChange={(image) => {
              onChange({ ...block, image });
            }}
            uploadActions={uploadActions}
            uploadEnabled={uploadEnabled}
          />
          <TextsInputs
            label="Bildunterschrift (optional)"
            value={block.caption}
            onChange={(caption) => {
              onChange({ ...block, caption });
            }}
          />
        </>
      );
  }
}

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

function ImageEditor({
  label,
  image,
  onChange,
  uploadActions,
  uploadEnabled,
}: {
  label: string;
  image: EditorImage | undefined;
  onChange: (image: EditorImage | undefined) => void;
  uploadActions: Props["uploadActions"];
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
