import type { AdminRole } from "@up/core";

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: "Inhaber/in",
  admin: "Admin",
  manager: "Manager/in",
  viewer: "Lesezugriff",
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  owner: "Alles, inklusive Team und Produktiv-Umstellung. Immer alle Objekte.",
  admin: "Inhalte, Services, Einstellungen und Team – keine Inhaber-Rechte.",
  manager: "Inhalte, Service-Katalog und Anfragen der gewählten Objekte.",
  viewer: "Nur lesen.",
};
