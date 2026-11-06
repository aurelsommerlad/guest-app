/**
 * Texts of verification messages (ADR 0021): the code, its validity and the property name –
 * nothing about the booking (no dates, no names, no links), so a mis-typed address leaks
 * nothing. Plain text and a minimal HTML version (no images, no tracking).
 */
import { type VerificationMessage } from "./message-ports";

export type VerificationEmailContent = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COPY = {
  de: {
    subject: (code: string) => `${code} ist Dein Bestätigungscode`,
    intro: (property: string) => `Dein Code zur Bestätigung Deiner E-Mail-Adresse für ${property}:`,
    validity: (minutes: number) => `Der Code ist ${String(minutes)} Minuten gültig.`,
    ignore:
      "Du hast keinen Online-Check-in begonnen? Dann kannst Du diese E-Mail einfach ignorieren.",
    sms: (code: string, property: string, minutes: number) =>
      `${code} ist Dein Bestätigungscode für ${property}. Gültig ${String(minutes)} Minuten.`,
  },
  en: {
    subject: (code: string) => `${code} is your confirmation code`,
    intro: (property: string) => `Your code to confirm your email address for ${property}:`,
    validity: (minutes: number) => `The code is valid for ${String(minutes)} minutes.`,
    ignore: "Didn't start an online check-in? Then simply ignore this email.",
    sms: (code: string, property: string, minutes: number) =>
      `${code} is your confirmation code for ${property}. Valid for ${String(minutes)} minutes.`,
  },
} as const;

export function verificationEmailContent(message: VerificationMessage): VerificationEmailContent {
  const copy = COPY[message.locale];
  const intro = copy.intro(message.propertyName);
  const validity = copy.validity(message.validMinutes);
  return {
    subject: copy.subject(message.code),
    text: `${intro}\n\n${message.code}\n\n${validity}\n\n${copy.ignore}\n`,
    html:
      `<p>${escapeHtml(intro)}</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:600">${escapeHtml(message.code)}</p>` +
      `<p>${escapeHtml(validity)}</p><p style="color:#666">${escapeHtml(copy.ignore)}</p>`,
  };
}

/** Short SMS, code first (OS autofill). Names with non-GSM letters are sent as UCS-2. */
export function verificationSmsText(message: VerificationMessage): string {
  return COPY[message.locale].sms(message.code, message.propertyName, message.validMinutes);
}
