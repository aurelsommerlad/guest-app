/**
 * Offer view model for the guest pages (pure): one shape for own services and partner offers,
 * localized, with the price from the right source (Extras for own services, the offer itself
 * for partners).
 */
import {
  type CancellationPolicy,
  chapterOf,
  type FulfillmentType,
  type OfferCategory,
  type OfferChapter,
  type OfferKind,
  type PropertyOffer,
  resolveLocalizedText,
} from "@up/core";

import { type ExtrasBookingView } from "./extras-merge";
import { type HouseServiceFacts } from "./house-services";

export type OfferPriceView =
  | {
      kind: "amount";
      amountCents: number;
      currency: string;
      per: "stay" | "night" | "person" | "person-night";
      from: boolean;
    }
  | { kind: "on-request" }
  | { kind: "at-booking" };

export type OfferView = {
  id: string;
  slug: string;
  href: string;
  kind: OfferKind;
  chapter: OfferChapter;
  category: OfferCategory;
  title: string;
  teaser: string;
  body: string[];
  details: string[];
  image?: { src: string; width: number; height: number; alt: string };
  price: OfferPriceView;
  /** Own services: price is a preview until the Extras bridge (Phase 2). */
  pricePreview: boolean;
  durationMinutes?: number;
  fulfillment: FulfillmentType;
  bookingUrl?: string;
  partnerName?: string;
  locality?: string;
  cancellation: CancellationPolicy;
  /** Phase 2: booking or request through the Extras bridge (own services only). */
  booking?: ExtrasBookingView;
};

function text(value: PropertyOffer["title"] | undefined, locale: string): string {
  return value ? resolveLocalizedText(value, locale, "de") : "";
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function paragraphs(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export function offerSlug(offer: Pick<PropertyOffer, "slug">, locale: string): string {
  return offer.slug[locale] ?? offer.slug.de ?? "";
}

export function toOfferView(
  offer: PropertyOffer,
  locale: string,
  house: HouseServiceFacts | undefined,
  live?: { price: OfferPriceView; booking: ExtrasBookingView },
): OfferView {
  let price: OfferPriceView = { kind: "at-booking" };
  if (live) {
    price = live.price;
  } else if (offer.kind === "house-service") {
    if (house?.amountCents !== undefined) {
      price = {
        kind: "amount",
        amountCents: house.amountCents,
        currency: house.currency,
        per: house.unit,
        from: false,
      };
    }
  } else if (offer.price) {
    price =
      offer.price.model === "on-request"
        ? { kind: "on-request" }
        : {
            kind: "amount",
            amountCents: offer.price.amountCents,
            currency: offer.price.currency,
            per: offer.price.model === "per-person" ? "person" : "stay",
            from: offer.price.model === "from",
          };
  }
  const slug = offerSlug(offer, locale);
  return {
    id: offer.id,
    slug,
    href: `/v2/services/${slug}`,
    kind: offer.kind,
    chapter: chapterOf(offer.kind),
    category: offer.category,
    title: text(offer.title, locale),
    teaser: text(offer.teaser, locale),
    body: paragraphs(text(offer.body, locale)),
    details: lines(text(offer.details, locale)),
    ...(offer.heroImage
      ? {
          image: {
            src: offer.heroImage.src,
            width: offer.heroImage.width,
            height: offer.heroImage.height,
            alt: resolveLocalizedText(offer.heroImage.alt, locale, "de"),
          },
        }
      : {}),
    price,
    pricePreview: !live && offer.kind === "house-service" && house?.preview === true,
    ...(offer.durationMinutes ? { durationMinutes: offer.durationMinutes } : {}),
    fulfillment: offer.fulfillment,
    ...(offer.bookingUrl ? { bookingUrl: offer.bookingUrl } : {}),
    ...(offer.partner ? { partnerName: offer.partner.name } : {}),
    ...(offer.partner?.locality ? { locality: offer.partner.locality } : {}),
    cancellation: offer.cancellation,
    ...(live ? { booking: live.booking } : {}),
  };
}

/** Own services Extras does not offer right now are not shown (never a dead end). */
export function isShowable(offer: PropertyOffer, house: HouseServiceFacts | undefined): boolean {
  return offer.kind === "partner" || house === undefined || house.available;
}
