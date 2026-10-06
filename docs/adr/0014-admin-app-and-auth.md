# 0014 – Admin App und Admin-Authentifizierung

**Status:** Akzeptiert (2026-10-05, Phase 9).

## Kontext

UNIQUE PLACES braucht ein zentrales Backend für die Pflege von Inhalten, beginnend mit GUIDE. Weitere Module (z. B. EXPLORE, Gastzugänge, Einstellungen) folgen später. Supabase Auth wird bewusst nicht genutzt ([ADR 0010](0010-database-foundation.md)). Admin-Konten sollen MFA-fähig sein, MFA selbst kommt später.

## Entscheidung

**App:**

- Eigene Next.js-App `apps/admin` im Monorepo, eigenes Vercel-Projekt (Root Directory `apps/admin`, Region `fra1`). Production: `admin.unique-places.com`, Staging und Previews getrennt.
- Dieselbe Datenbank pro Environment wie die Guest App, Zugriff ausschließlich serverseitig über `@up/db`.
- **Admin-Shell (ab Phase 9.2):** feste Sidebar (Desktop) bzw. Drawer (Tablet/Mobile, natives `<dialog>`), darüber der globale Kontext mit dem Property Selector, rechts die Arbeitsfläche des Moduls.
- **Modul-Registry** (`src/navigation.ts`): langfristige Gruppen (Dashboard, Gäste, Kommunikation, Inhalte, Services, Verwaltung); jedes Modul hat Gruppe, URL-Segment, Icon und Scope. Angezeigt werden nur vorhandene Module, leere Gruppen entfallen. Neue Module sind ein Eintrag plus Route; Platzhalterseiten gibt es nicht.
- **Property Context:** Die URL ist die Quelle. Property-Module liegen unter `/{modul}` („Alle Objekte“) und `/{modul}/{propertyId}/…`; tenant-weite Module (z. B. Objekte) unter `/{modul}`. Deep Links, Reload und Zurück/Vor funktionieren dadurch ohne Zusatzlogik. Ein Cookie `up_admin_property` merkt sich die letzte Wahl nur als Komfort (Startseite, Seiten ohne Property in der URL). Er wird serverseitig gegen die Properties des Tenants geprüft und nie für Berechtigungen verwendet. Jede Property-Route prüft die Property tenant-scoped (sonst 404).
- Module, die eine Property brauchen (Guide), zeigen bei „Alle Objekte“ eine Objektauswahl statt gemischter Inhalte. Künftige Module können „Alle Objekte“ aggregieren (Scope `allProperties: "aggregate"`, z. B. Inbox, Dashboard).
- Alte URLs `/properties/{id}/guide/…` leiten auf `/guide/{id}/…` weiter.
- Alle Seiten sind dynamisch und `noindex`; Security-Header wie in der Guest App, zusätzlich `Referrer-Policy: same-origin`.
- Design: dieselben Tokens und Fonts aus `@up/ui`.

**Konten (`admin_users`):**

- E-Mail (klein geschrieben, eindeutig) und Passwort, ein Konto gehört genau einem Tenant. Status `active | disabled`.
- Passwort-Hash mit scrypt (N=2^15, r=8, p=1, 16 Byte Salt), Format `scrypt$N$r$p$salt$hash`, Vergleich in konstanter Zeit. Für unbekannte E-Mails wird gegen einen Dummy-Hash geprüft, damit die Antwortzeit nichts verrät.
- Passwortlänge 12–200 Zeichen.
- MFA-fähig: Konten und Sessions sind getrennte Tabellen; ein zweiter Faktor kann später zwischen Passwortprüfung und Session-Erstellung eingefügt werden.

**Sessions (`admin_sessions`):**

- Opakes 256-Bit-Secret im Cookie, in der DB nur dessen SHA-256-Hash. Absolute Laufzeit 12 Stunden, kein Sliding.
- Cookie `__Host-up_admin_session` (lokal `up_admin_session`): `HttpOnly`, `Secure` (außer lokal), `SameSite=Strict`, `Path=/`.
- Jede Anfrage prüft die Session serverseitig; deaktivierte Konten verlieren den Zugriff sofort. Logout widerruft die Session in der DB.
- Server Actions prüfen die Session selbst und laden Einträge immer über den `TenantContext` der Session. Eine Property oder ein Eintrag eines anderen Tenants ist nicht erreichbar (Not Found).

**Rate Limits** (gleiche Tabelle `rate_limit_buckets` wie der Gastzugang):

- Login: 10 Versuche pro 15 Minuten pro Client, 5 pro Konto.
- Setup: 5 Versuche pro 15 Minuten pro Client.

**Erstes Konto:**

- Einmalige Seite `/setup`, nur aktiv, solange `ADMIN_SETUP_TOKEN` gesetzt ist (mindestens 32 Zeichen) **und** noch kein Admin-Konto existiert. Sonst 404. Token, Tenant-Slug, E-Mail und Passwort werden geprüft; das Token wird danach aus Vercel entfernt.
- Alternativ per CLI mit direkter DB-Verbindung: `ADMIN_PASSWORD=… pnpm admin-user:create --target … --tenant … --email …` (Passwort nur aus der Umgebung).

**Logging:** keine Passwörter, Tokens, Session-Secrets oder E-Mail-Adressen in Logs; nur Konto-IDs und Ereignisse.

## Konsequenzen

- Keine Abhängigkeit von Supabase Auth; Konten, Sessions und Widerruf liegen vollständig in der eigenen DB.
- Rollen und Rechte innerhalb eines Tenants gibt es noch nicht: jedes aktive Konto darf alle Inhalte seines Tenants pflegen. Rollen (z. B. Redakteur, Owner) und Passwort-Reset folgen bei Bedarf.
- Passwort zurücksetzen geht derzeit nur über die CLI bzw. die Datenbank.
