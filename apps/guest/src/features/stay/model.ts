import {
  type AccessCredentialType,
  type JourneyPhase,
  type LocalizedText,
  type PmsReservationStatus,
  type StayPhase,
} from "@up/core";
import { type StaticImageData } from "next/image";

import { type Locale } from "../../i18n/routing";

/**
 * Source data of a stay – the shape the screen needs from the backend.
 * Today it comes from a mock; later from our database (Apaleo projection).
 */
export type StaySource = {
  tenantId: string;
  /** First name may be missing in the PMS – the greeting then omits it. */
  guest: { firstName?: string };
  property: {
    id: string;
    /** Display name exactly as branded, e.g. "HØV", "ΛLPILΛ". */
    name: string;
    /** Plain pronounceable name for screen readers, e.g. "Alpila". */
    spokenName: string;
    location: string;
    timeZone: string;
  };
  unit: { id: string; name: string };
  reservation: {
    status: PmsReservationStatus;
    /** ISO 8601 instants with offset. */
    checkInAt: string;
    checkOutAt: string;
    /** Travellers on the reservation, if the PMS delivers them (sizes the online check-in). */
    guestCount?: { adults: number; children: number };
  };
  cards: readonly StayCardSource[];
};

export type StayCardSource = {
  id: "guide" | "extras" | "explore";
  /** Locale-less app path, e.g. "/guide". */
  href: string;
  title: LocalizedText;
  subtitle: LocalizedText;
  image: ImageAsset;
};

/** A photo. Static imports today, storage URLs (string) later. */
export type ImageAsset = {
  src: StaticImageData | string;
  /** Describes the photo where it carries meaning; card photos are decorative. */
  alt: LocalizedText;
  /** CSS object-position, to keep the subject in frame when cropped. */
  focus?: string;
};

/** Everything the STAY home screen renders – resolved for one locale. */
export type StayViewModel = {
  locale: Locale;
  phase: StayPhase;
  guest: { firstName?: string };
  property: { name: string; spokenName: string; location: string };
  unit: { name: string; href: string };
  /** Guest journey phase (property-local days); undefined without journey data. */
  journeyPhase?: JourneyPhase;
  /** The primary tile changes with the journey. */
  status: StayStatus;
  /** Access information – only from the arrival day on, never the code itself. */
  access?: StayAccessView;
  cards: readonly StayCard[];
};

export type LocalTime = { time: string; date: string; dateTime: string };

export type StayStatus =
  | ({ kind: "check-out"; today: boolean } & LocalTime)
  | ({ kind: "check-in" } & LocalTime)
  | { kind: "online-check-in"; stepsRemaining: number; href: string; started: boolean };

/** What the STAY access panel shows. The code is revealed on demand only. */
export type StayAccessView =
  | {
      kind: "available";
      credentialType: AccessCredentialType;
      validFrom: LocalTime;
      instructions?: string;
    }
  | { kind: "manual"; instructions?: string }
  | { kind: "registration-required"; href: string }
  | ({ kind: "not-yet-released" } & LocalTime)
  | { kind: "not-issued" };

export type StayCard = {
  id: StayCardSource["id"];
  href: string;
  title: string;
  subtitle: string;
  image: { src: StaticImageData | string; alt: string; focus?: string };
};
