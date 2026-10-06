/**
 * "Was passiert als Nächstes?" after the online check-in – built only from real state:
 * check-in time, the access decision and the official guest registration's sync status.
 * Features that do not exist (guest card, payment) never appear.
 */
import { type IconName } from "@up/ui";

import { guestRegistrationStatus, type StayJourney } from "../journey/stay-journey";

export type NextStepKey =
  | "nextCheckIn"
  | "nextAccessTime"
  | "nextAccessDay"
  | "nextAccessNow"
  | "nextGuestRegistrationSubmitted"
  | "nextGuestRegistrationPending";

export type NextStep = {
  id: "check-in" | "access" | "guest-registration";
  icon: IconName;
  key: NextStepKey;
  values?: { time?: string; date?: string };
};

export function nextStepsAfterCheckIn(
  journey: Pick<StayJourney, "journey" | "access" | "window" | "settings" | "syncs">,
  format: { time: (iso: string) => string; date: (iso: string) => string },
): NextStep[] {
  const steps: NextStep[] = [];
  const { phase } = journey.journey;
  if (phase === "before-arrival" || phase === "arrival-day") {
    const { checkInAt } = journey.window;
    steps.push({
      id: "check-in",
      icon: "clock",
      key: "nextCheckIn",
      values: { time: format.time(checkInAt), date: format.date(checkInAt) },
    });
  }
  const { access } = journey;
  if (access.status === "available" || access.status === "manual") {
    steps.push({ id: "access", icon: "key", key: "nextAccessNow" });
  } else if (access.reason === "not-yet-released" && access.releasesAt) {
    const withTime = Date.parse(access.releasesAt) === Date.parse(journey.window.checkInAt);
    steps.push({
      id: "access",
      icon: "lock",
      key: withTime ? "nextAccessTime" : "nextAccessDay",
      values: withTime
        ? { time: format.time(access.releasesAt), date: format.date(access.releasesAt) }
        : { date: format.date(journey.window.checkInAt) },
    });
  }
  const registration = guestRegistrationStatus(journey);
  if (registration) {
    steps.push({
      id: "guest-registration",
      icon: "file-text",
      key:
        registration === "submitted"
          ? "nextGuestRegistrationSubmitted"
          : "nextGuestRegistrationPending",
    });
  }
  return steps;
}
