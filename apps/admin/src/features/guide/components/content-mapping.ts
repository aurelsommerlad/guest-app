import {
  type ContentImage,
  type GuideBlock,
  type GuideContent,
  type LocalizedText,
} from "@up/core";

import {
  type EditorBlock,
  type EditorContent,
  type EditorImage,
  type Texts,
} from "./content-types";

/** Stored content ⇄ editor state. Empty English values are simply omitted on save. */

const texts = (value: LocalizedText | undefined): Texts => ({
  de: value?.de ?? "",
  en: value?.en ?? "",
});

const image = (value: ContentImage): EditorImage => ({
  src: value.src,
  width: value.width,
  height: value.height,
  alt: texts(value.alt),
});

/** Blocks the editor cannot edit (e.g. legacy "action") are kept out of the editor. */
export function toEditorContent(content: GuideContent): EditorContent {
  const blocks = content.blocks.flatMap((block: GuideBlock): EditorBlock[] => {
    switch (block.type) {
      case "heading":
      case "paragraph":
        return [{ id: block.id, type: block.type, text: texts(block.text) }];
      case "list":
        return [{ id: block.id, type: "list", style: block.style, items: block.items.map(texts) }];
      case "callout":
        return [
          { id: block.id, type: "callout", title: texts(block.title), text: texts(block.text) },
        ];
      case "link":
        return [{ id: block.id, type: "link", label: texts(block.label), href: block.href }];
      case "image":
        return [
          { id: block.id, type: "image", image: image(block.image), caption: texts(block.caption) },
        ];
      case "action":
        return [];
    }
  });
  return {
    intro: texts(content.intro),
    heroImage: content.heroImage ? image(content.heroImage) : undefined,
    blocks,
  };
}

const out = (value: Texts) => ({
  de: value.de.trim(),
  ...(value.en.trim() ? { en: value.en.trim() } : {}),
});
const outOptional = (value: Texts) => (value.de.trim() || value.en.trim() ? out(value) : undefined);
const outImage = (value: EditorImage) => ({
  src: value.src,
  width: value.width,
  height: value.height,
  alt: out(value.alt),
});

/** The JSON the server validates with guideContentSchema. */
export function fromEditorContent(content: EditorContent): unknown {
  return {
    intro: { de: content.intro.de, en: content.intro.en },
    ...(content.heroImage ? { heroImage: outImage(content.heroImage) } : {}),
    blocks: content.blocks.flatMap((block): unknown[] => {
      switch (block.type) {
        case "heading":
        case "paragraph":
          return [{ id: block.id, type: block.type, text: out(block.text) }];
        case "list":
          return [{ id: block.id, type: "list", style: block.style, items: block.items.map(out) }];
        case "callout": {
          const title = outOptional(block.title);
          return [{ id: block.id, type: "callout", text: out(block.text), title: title ?? {} }];
        }
        case "link":
          return [{ id: block.id, type: "link", label: out(block.label), href: block.href.trim() }];
        case "image":
          return block.image
            ? [
                {
                  id: block.id,
                  type: "image",
                  image: outImage(block.image),
                  caption: outOptional(block.caption) ?? {},
                },
              ]
            : [];
      }
    }),
  };
}
