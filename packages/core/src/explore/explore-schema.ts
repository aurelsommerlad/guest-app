import { z } from "zod";

import {
  contentImageSchema,
  httpUrlSchema,
  localizedSlugSchema,
  localizedTextSchema,
  optionalLocalizedTextSchema,
} from "../guide/guide-schema";
import { ENTITY_KEY_PATTERN } from "../tenancy/tenancy-model";
import { EXPLORE_CATEGORIES } from "./explore-model";

/**
 * Validation of an EXPLORE place as the admin submits it. Strict and length-limited;
 * links must be http(s) (no javascript:, mailto: … as "website"); no HTML anywhere.
 */

/** "" (empty form field) → undefined, otherwise the trimmed value. */
const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );

export const exploreCategorySchema = z.enum(EXPLORE_CATEGORIES);

/** Digits, spaces, + ( ) / - – rendered as tel: link with digits and + only. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()/-]{2,38}$/, "invalid phone number")
  .refine((value) => value.replace(/\D/g, "").length >= 3, "invalid phone number");

export function explorePlaceSchema(isAllowedImageSrc: (src: string) => boolean) {
  return z.strictObject({
    title: localizedTextSchema(120),
    slug: localizedSlugSchema,
    category: exploreCategorySchema,
    teaser: localizedTextSchema(220),
    description: optionalLocalizedTextSchema(6000).optional(),
    tip: optionalLocalizedTextSchema(1000).optional(),
    openingHours: optionalLocalizedTextSchema(400).optional(),
    heroImage: contentImageSchema(isAllowedImageSrc).optional(),
    address: blank(z.string().trim().max(300)),
    locality: blank(z.string().trim().max(80)),
    mapsUrl: blank(httpUrlSchema),
    websiteUrl: blank(httpUrlSchema),
    reservationUrl: blank(httpUrlSchema),
    phone: blank(phoneSchema),
    featured: z.boolean(),
    propertyIds: z
      .array(z.string().regex(ENTITY_KEY_PATTERN))
      .max(100)
      .transform((ids) => [...new Set(ids)]),
  });
}

export type ExplorePlaceInput = z.output<ReturnType<typeof explorePlaceSchema>>;
