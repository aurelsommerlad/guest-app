import {
  type ContentImage,
  type GuideBlock,
  type GuideSection,
  type LocalizedText,
  resolveLocalizedText,
} from "@up/core";

import { type Locale, routing } from "../../i18n/routing";
import {
  type GuideArticle,
  type GuideOverviewItem,
  type ResolvedBlock,
  type ResolvedImage,
} from "./model";

/** Pure mapping from content (all locales) to the screens' view models (one locale). */
export function createGuideResolver(locale: Locale) {
  const text = (value: LocalizedText) => resolveLocalizedText(value, locale, routing.defaultLocale);
  const optional = (value: LocalizedText | undefined) => (value ? text(value) : undefined);

  const image = (value: ContentImage): ResolvedImage => ({
    src: value.src,
    width: value.width,
    height: value.height,
    alt: text(value.alt),
    blurDataUrl: value.blurDataUrl,
  });

  const block = (value: GuideBlock): ResolvedBlock => {
    switch (value.type) {
      case "heading":
      case "paragraph":
        return { id: value.id, type: value.type, text: text(value.text) };
      case "list":
        return { id: value.id, type: "list", style: value.style, items: value.items.map(text) };
      case "callout":
        return {
          id: value.id,
          type: "callout",
          title: optional(value.title),
          text: text(value.text),
        };
      case "image":
        return {
          id: value.id,
          type: "image",
          image: image(value.image),
          caption: optional(value.caption),
        };
      case "link":
        return { id: value.id, type: "link", label: text(value.label), href: value.href };
      case "action":
        return {
          id: value.id,
          type: "action",
          action: value.action,
          label: text(value.label),
          value: value.value,
        };
    }
  };

  return {
    slug: (section: GuideSection) => text(section.slug),

    overviewItem: (section: GuideSection): GuideOverviewItem => ({
      id: section.id,
      href: `/guide/${text(section.slug)}`,
      title: text(section.title),
      description: text(section.shortDescription),
      icon: section.icon,
    }),

    article: (section: GuideSection): GuideArticle => ({
      id: section.id,
      title: text(section.title),
      eyebrow: optional(section.eyebrow),
      intro: optional(section.intro),
      heroImage: section.heroImage ? image(section.heroImage) : undefined,
      blocks: section.blocks.map(block),
    }),
  };
}
