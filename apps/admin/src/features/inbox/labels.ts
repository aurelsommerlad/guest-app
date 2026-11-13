import type { ConversationChannel, ConversationStatus } from "@up/core";

export const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  stay_chat: "STAY Chat",
  booking_com: "Booking.com",
  airbnb: "Airbnb",
  expedia: "Expedia",
  whatsapp: "WhatsApp",
  other: "Sonstiger Kanal",
};

/** Short typographic marks instead of colours or logos (magazine style). */
export const CHANNEL_MARKS: Record<ConversationChannel, string> = {
  stay_chat: "ST",
  booking_com: "BK",
  airbnb: "AB",
  expedia: "EX",
  whatsapp: "WA",
  other: "··",
};

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Offen",
  pending: "Wartet auf Gast",
  done: "Erledigt",
};

export const KIND_LABELS: Record<string, string> = {
  reservation: "Reservierung",
  inquiry: "Anfrage ohne Buchung",
  reservation_request: "Buchungsanfrage",
  general: "Allgemein",
};

export const DELIVERY_LABELS: Record<string, string> = {
  received: "Empfangen",
  queued: "Wird gesendet",
  sending: "Wird gesendet",
  sent: "Gesendet",
  delivered: "Zugestellt",
  read: "Gelesen",
  failed: "Nicht gesendet",
  uncertain: "Zustellung ungewiss",
};

export const DELIVERY_ERROR_LABELS: Record<string, string> = {
  simulated_failure: "Simulierter Fehler – nichts wurde gesendet.",
};

export const EVENT_LABELS: Record<string, string> = {
  created: "Unterhaltung begonnen",
  status_changed: "Status geändert",
  assigned: "Zugewiesen",
  unassigned: "Zuweisung aufgehoben",
  reservation_linked: "Reservierung verknüpft",
  reservation_unlinked: "Reservierung gelöst",
  note_added: "Interne Notiz",
  reply_queued: "Antwort gesendet",
  message_failed: "Zustellung fehlgeschlagen",
  message_uncertain: "Zustellung ungewiss",
  delivery_retried: "Erneut versucht",
  external_closed: "Im Kanal geschlossen",
  no_reply_needed: "Keine Antwort nötig",
  attachment_rejected: "Anhang abgelehnt",
};

const time = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
const dayMonth = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Berlin",
});
const full = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
const dateOnly = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Berlin",
});

function sameDay(a: Date, b: Date): boolean {
  return dayMonth.format(a) === dayMonth.format(b) && a.getFullYear() === b.getFullYear();
}

/** List time: today → "14:05", otherwise "13. Nov.". */
export function listTime(value: Date | null, now: Date): string {
  if (!value) return "";
  return sameDay(value, now) ? time.format(value) : dayMonth.format(value);
}

export function messageTime(value: Date): string {
  return full.format(value);
}

export function stayDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateOnly.format(parsed);
}
