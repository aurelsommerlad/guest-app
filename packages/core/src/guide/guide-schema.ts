import { z } from "zod";

import { ENTITY_KEY_PATTERN } from "../tenancy/tenancy-model";
import { CONTENT_LOCALES, GUIDE_ICONS, GUIDE_STATUSES } from "./guide-model";

/**
 * Validation of guide content as it is stored (jsonb) and as the admin submits it.
 * Strict: unknown fields are rejected, texts are length-limited, links are http(s),
 * images must come from an allowed origin. No HTML anywhere – text is rendered as text.
 */

const text = (max: number) => z.string().trim().max(max);

/** { de, en } – German (source language) required, English optional. */
export const localizedTextSchema = (max: number) =>
  z
    .strictObject({ de: text(max).min(1), en: text(max).optional() })
    .transform((value) => (value.en ? value : { de: value.de }));

/** Like localizedTextSchema, but completely empty values become undefined. */
export const optionalLocalizedTextSchema = (max: number) =>
  z.strictObject({ de: text(max).optional(), en: text(max).optional() }).transform((value) => {
    const result = Object.fromEntries(
      CONTENT_LOCALES.flatMap((locale) => (value[locale] ? [[locale, value[locale]]] : [])),
    );
    return Object.keys(result).length > 0 ? result : undefined;
  });

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "must be an http(s) URL");

export function contentImageSchema(isAllowedImageSrc: (src: string) => boolean) {
  return z.strictObject({
    src: z.string().max(2000).refine(isAllowedImageSrc, "image source not allowed"),
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(20_000),
    alt: localizedTextSchema(300),
    blurDataUrl: z.string().max(4000).startsWith("data:image/").optional(),
  });
}

const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export function guideBlockSchema(isAllowedImageSrc: (src: string) => boolean) {
  return z.discriminatedUnion("type", [
    z.strictObject({ id: blockId, type: z.literal("heading"), text: localizedTextSchema(200) }),
    z.strictObject({ id: blockId, type: z.literal("paragraph"), text: localizedTextSchema(5000) }),
    z.strictObject({
      id: blockId,
      type: z.literal("list"),
      style: z.enum(["bullet", "steps"]),
      items: z.array(localizedTextSchema(500)).min(1).max(50),
    }),
    z.strictObject({
      id: blockId,
      type: z.literal("callout"),
      title: optionalLocalizedTextSchema(200).optional(),
      text: localizedTextSchema(2000),
    }),
    z.strictObject({
      id: blockId,
      type: z.literal("image"),
      image: contentImageSchema(isAllowedImageSrc),
      caption: optionalLocalizedTextSchema(300).optional(),
    }),
    z.strictObject({
      id: blockId,
      type: z.literal("link"),
      label: localizedTextSchema(200),
      href: httpUrl,
    }),
  ]);
}

/** Intro, hero image and blocks – what both topics and overrides carry. */
export function guideContentSchema(isAllowedImageSrc: (src: string) => boolean) {
  return z.strictObject({
    intro: optionalLocalizedTextSchema(1000).optional(),
    heroImage: contentImageSchema(isAllowedImageSrc).optional(),
    blocks: z.array(guideBlockSchema(isAllowedImageSrc)).max(100),
  });
}

/** URL segment per locale: lowercase letters, digits and hyphens. */
const slugText = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "invalid slug");
export const localizedSlugSchema = z.strictObject({ de: slugText, en: slugText.optional() });

export const guideTopicMetaSchema = z.strictObject({
  title: localizedTextSchema(120),
  shortDescription: localizedTextSchema(200),
  eyebrow: optionalLocalizedTextSchema(60).optional(),
  slug: localizedSlugSchema,
  icon: z.enum(GUIDE_ICONS),
});

export const guideStatusSchema = z.enum(GUIDE_STATUSES);
export const guideKeySchema = z.string().regex(ENTITY_KEY_PATTERN);

/** Turns a title into a URL segment ("Ankunft & Parken" → "ankunft-parken"). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
