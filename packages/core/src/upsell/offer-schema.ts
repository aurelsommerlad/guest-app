/**
 * Validation of partners and offers as the admin (Phase 3) or a seed submits them. Strict,
 * length-limited, no HTML; links http(s) only; images through the same media rules as GUIDE
 * and EXPLORE (`isAllowedImageSrc`).
 */
import { z } from "zod";

import {
  contentImageSchema,
  httpUrlSchema,
  localizedSlugSchema,
  localizedTextSchema,
  optionalLocalizedTextSchema,
} from "../guide/guide-schema";
import { JOURNEY_PHASES } from "../journey/guest-journey";
import { ENTITY_KEY_PATTERN } from "../tenancy/tenancy-model";
import {
  categoriesFor,
  fulfillmentsFor,
  OFFER_CATEGORIES,
  OFFER_KINDS,
  FULFILLMENT_TYPES,
} from "./offer-model";

const currency = z.string().regex(/^[A-Z]{3}$/);
const cents = z.number().int().min(0).max(10_000_000);
const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/);

export const commissionModelSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({ type: z.literal("percent"), basisPoints: z.number().int().min(1).max(5000) }),
  z.strictObject({ type: z.literal("fixed"), amountCents: cents.min(1), currency }),
]);

export const cancellationPolicySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("free-until"), hoursBefore: z.number().int().min(0).max(720) }),
  z.strictObject({ type: z.literal("non-refundable") }),
  z.strictObject({ type: z.literal("on-request") }),
  z.strictObject({ type: z.literal("partner-terms") }),
]);

export const offerPriceSchema = z.discriminatedUnion("model", [
  z.strictObject({ model: z.literal("on-request") }),
  z.strictObject({ model: z.enum(["fixed", "from", "per-person"]), amountCents: cents, currency }),
]);

export const offerAvailabilitySchema = z.strictObject({
  phases: z.array(z.enum(JOURNEY_PHASES)).max(5),
  focusPhases: z.array(z.enum(JOURNEY_PHASES)).max(5),
  seasons: z.array(z.strictObject({ from: monthDay, to: monthDay })).max(6),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  showFromDaysBeforeArrival: z.number().int().min(0).max(365).optional(),
});

export const partnerSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[^<>]+$/),
  status: z.enum(["active", "inactive"]),
  explorePlaceId: z.uuid().optional(),
  websiteUrl: httpUrlSchema.optional(),
  commission: commissionModelSchema,
});
export type PartnerInput = z.output<typeof partnerSchema>;

export function offerSchema(isAllowedImageSrc: (src: string) => boolean) {
  return z
    .strictObject({
      kind: z.enum(OFFER_KINDS),
      partnerId: z.uuid().optional(),
      category: z.enum(OFFER_CATEGORIES),
      title: localizedTextSchema(120),
      slug: localizedSlugSchema,
      teaser: localizedTextSchema(220),
      body: optionalLocalizedTextSchema(6000).optional(),
      details: optionalLocalizedTextSchema(1500).optional(),
      heroImage: contentImageSchema(isAllowedImageSrc).optional(),
      gallery: z.array(contentImageSchema(isAllowedImageSrc)).max(8),
      fulfillment: z.enum(FULFILLMENT_TYPES),
      bookingUrl: httpUrlSchema.optional(),
      price: offerPriceSchema.optional(),
      durationMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60 * 14)
        .optional(),
      cancellation: cancellationPolicySchema,
      commission: commissionModelSchema.optional(),
      availability: offerAvailabilitySchema,
      featured: z.boolean(),
      sortOrder: z.number().int().min(0).max(10_000),
      properties: z
        .array(
          z.strictObject({
            propertyId: z.string().regex(ENTITY_KEY_PATTERN),
            extrasServiceId: z
              .string()
              .trim()
              .min(1)
              .max(120)
              .regex(/^[A-Za-z0-9_-]+$/)
              .optional(),
            sortOrder: z.number().int().min(0).max(10_000),
          }),
        )
        .max(100),
    })
    .superRefine((offer, ctx) => {
      const issue = (path: string, message: string) => { ctx.addIssue({ code: "custom", path: [path], message }); };
      if (!categoriesFor(offer.kind).includes(offer.category)) {
        issue("category", "category does not fit the kind");
      }
      if (!fulfillmentsFor(offer.kind).includes(offer.fulfillment)) {
        issue("fulfillment", "fulfillment does not fit the kind");
      }
      if (offer.kind === "partner") {
        if (!offer.partnerId) issue("partnerId", "partner offers need a partner");
        if (!offer.price) issue("price", "partner offers need a price model");
        if (offer.fulfillment === "link" && !offer.bookingUrl)
          issue("bookingUrl", "link needs a URL");
      } else {
        // Price, availability and booking of own services come from the Extras catalog.
        if (offer.partnerId) issue("partnerId", "own services have no partner");
        if (offer.price) issue("price", "own services take their price from Extras");
        if (offer.commission) issue("commission", "own services carry no commission");
        if (offer.bookingUrl) issue("bookingUrl", "own services are booked in STAY");
      }
      if (
        offer.availability.focusPhases.some(
          (phase) =>
            offer.availability.phases.length > 0 && !offer.availability.phases.includes(phase),
        )
      ) {
        issue("availability", "focus phases must be shown phases");
      }
    });
}
export type OfferInput = z.output<ReturnType<typeof offerSchema>>;
