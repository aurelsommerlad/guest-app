/** Editor-side shapes of guide content (same structure as GuideContent, all locales editable). */
export type Texts = { de: string; en: string };
export type EditorImage = { src: string; width: number; height: number; alt: Texts };

export type EditorBlock =
  | { id: string; type: "heading"; text: Texts }
  | { id: string; type: "paragraph"; text: Texts }
  | { id: string; type: "list"; style: "bullet" | "steps"; items: Texts[] }
  | { id: string; type: "callout"; title: Texts; text: Texts }
  | { id: string; type: "link"; label: Texts; href: string }
  | { id: string; type: "image"; image: EditorImage | undefined; caption: Texts };

export type EditorContent = {
  intro: Texts;
  heroImage: EditorImage | undefined;
  blocks: EditorBlock[];
};

export const emptyTexts = (): Texts => ({ de: "", en: "" });

export const BLOCK_TYPES = [
  { type: "heading", label: "Überschrift" },
  { type: "paragraph", label: "Text" },
  { type: "list", label: "Liste" },
  { type: "callout", label: "Hinweis" },
  { type: "link", label: "Link" },
  { type: "image", label: "Bild" },
] as const satisfies readonly { type: EditorBlock["type"]; label: string }[];

export function newBlock(type: EditorBlock["type"]): EditorBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case "heading":
    case "paragraph":
      return { id, type, text: emptyTexts() };
    case "list":
      return { id, type, style: "bullet", items: [emptyTexts()] };
    case "callout":
      return { id, type, title: emptyTexts(), text: emptyTexts() };
    case "link":
      return { id, type, label: emptyTexts(), href: "" };
    case "image":
      return { id, type, image: undefined, caption: emptyTexts() };
  }
}
