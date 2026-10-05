# Architektur – UNIQUE PLACES Guest App

Stand: Phase 5 (EXPLORE-Grundstruktur mit Mock-Inhalten). Dies ist der freigegebene Architekturplan, inklusive der Änderungen aus der Freigabe.
Einzelne Entscheidungen sind in [`adr/`](adr/) begründet.

## 1. Leitlinien

- **Multi-Tenant-fähiges Fundament, kein SaaS auf Vorrat.**
  - Das Modell `Tenant → Property → Unit → Reservation` gilt ab Tag 1. UNIQUE PLACES ist Tenant 1.
  - Property-Namen (HØV, HŪSLE, ΛLPILΛ, LÆKE) sind Daten, nie Code-Sonderfälle.
  - Nicht gebaut werden: Billing, Registrierung, Subscriptions, Onboarding.
- **Modularität:** UI, Business-Logik und Integrationen sind strikt getrennt. Integrationen sind Provider hinter Interfaces.
- **Eigene Daten in eigener Datenbank:**
  - Apaleo ist die Source of Truth für Reservierungen.
  - Die Guest App liest eine lokale Kopie und funktioniert auch, wenn externe APIs ausfallen.
- **YAGNI:** Was später kommt, bekommt höchstens eine Schnittstelle oder Tabelle, keine Funktionalität.

## 2. Tech Stack (bestätigt)

| Bereich     | Wahl                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| App         | Next.js (App Router), React, TypeScript strict                                         |
| Hosting     | Vercel, Region `fra1`                                                                  |
| Datenbank   | Supabase PostgreSQL (EU), genutzt als Standard-Postgres                                |
| DB-Zugriff  | Drizzle ORM + Drizzle Kit (kein `supabase-js`-Datenzugriff im Client)                  |
| Styling     | Tailwind CSS v4, Tokens als CSS Custom Properties                                      |
| Fonts       | `next/font`, selbst gehostet (Josefin Sans, Roboto), keine Laufzeit-Requests an Google |
| i18n        | next-intl (DE, EN)                                                                     |
| Validierung | Zod                                                                                    |
| Monorepo    | pnpm Workspaces + Turborepo                                                            |
| Tests       | Vitest, später Playwright + axe                                                        |
| CI          | GitHub Actions                                                                         |

## 3. Repository-Struktur

```
apps/guest          Guest App                        apps/admin  (später, ggf. zuerst nur Content-Editor)
packages/config     TS-/ESLint-Konfiguration
packages/core       Domain, Use Cases, Ports, Env, Logger – framework-frei
packages/ui         Design Tokens + Komponenten – ohne Domain-Wissen
packages/db         Drizzle-Schema, Migrationen, tenant-scoped Repositories, Seeds
packages/integrations  Provider-Adapter (Mock, Apaleo …)
```

- Packages liefern TypeScript-Quellen aus, die Next.js über `transpilePackages` kompiliert. Es gibt keinen eigenen Build-Schritt.
- Abhängigkeitsrichtung: `apps → ui | core | db | integrations`, `db → core`, `integrations → core`.
- Diese Regeln werden per ESLint erzwungen (`packages/config/eslint/base.js`, `boundaries`).
- Ein `auth`-Package wird erst mit der Admin-App bzw. dem Content-Editor herausgelöst.

## 4. Domain Model

```
Tenant ─┬─ TenantDomain · Brand · ModuleConfig · TenantSettings
        ├─ Property ── Unit ── Reservation ── GuestAccess
        ├─ GuideCategory ── GuideArticle            (Scope: Tenant | Property | Unit)
        ├─ ExploreCategory ── Recommendation ── Tag
        ├─ MediaAsset
        ├─ IntegrationConnection ── SyncRun · WebhookEvent
        ├─ (später) User ── Membership(role)
        └─ AuditLog
```

- **Stay-Zustand** (`upcoming`, `in_house`, `departed`): wird aus Reservation und Zeitzone der Property berechnet, nicht gespeichert.
- **Property-Namen:** Felder `displayName` („ΛLPILΛ“), `slug` („alpila“) und `spokenName` („Alpila“, für Screenreader).
- **Module** (stay, guide, explore, extras, später chat, checkin, access): pro Tenant bzw. Property über `ModuleConfig` aktivierbar.

## 5. Datenmodell (Grundregeln)

- Jede tenant-bezogene Tabelle hat `tenant_id NOT NULL`. Fremdschlüssel sind zusammengesetzt, `(tenant_id, …_id)`.
- UUIDs als IDs. Slugs sind pro Tenant eindeutig.
- Mehrsprachige Inhalte als `jsonb` vom Typ `LocalizedText` (`{ "de": "…", "en": "…" }`), Zod-validiert.
- `reservations` sind eine **lokale Kopie** der PMS-Daten (`external_provider`, `external_id`, `synced_at`), minimiert auf das Nötige.
- Vorbereitete Tabellen ohne Funktion: `integration_connections`, `sync_runs`, `webhook_events`, `audit_logs`.

## 6. Tenant-Isolation

1. **Anwendung:** Repositories in `packages/db` verlangen einen `TenantContext`. Apps führen keine rohen Queries aus.
2. **Schema:** `tenant_id` überall, zusammengesetzte Fremdschlüssel, eindeutige Indizes pro Tenant.
3. **RLS:**
   - Sofort: „deny all“ für die Supabase-Rollen `anon` und `authenticated`.
   - Vorbereitet: Tenant-Policies über `app.tenant_id`, aktiviert spätestens mit Admin bzw. Content-Editor oder dem 2. Tenant.

Tenant-Auflösung:

- Für Gäste über das Token: Token → Reservation → Tenant.
- Für öffentliche Seiten über den Host (`tenant_domains`).
- Stimmen beide nicht überein, wird der Zugriff verweigert.

Tests: Integrationstests mit zwei Tenants (Phase 3) beweisen die Isolation.

## 7. Auth

**Gäste:** Token-Link ohne Account ([ADR 0004](adr/0004-guest-access.md)).

- Zufälliges Token (≥ 128 Bit), in der Datenbank nur als Hash gespeichert.
- `/s/{token}` wird serverseitig geprüft. Danach setzt der Server ein httpOnly-, Secure- und SameSite=Lax-Session-Cookie und leitet weiter. **Das Token verschwindet aus der URL.**
- Ablauf: **Abreise + 3 Tage**. Der Wert wird als Tenant- bzw. Property-Einstellung modelliert (`guestAccess.expiresAfterDepartureDays`, Default 3), damit er später konfigurierbar ist.
- Widerrufbar, mit Rate-Limiting.
- Zugriffsstufen:
  - `public`: z. B. QR-Code im Apartment, ohne Personendaten
  - `reservation`: per Link
  - später `verified`: Step-up für Check-in-, Ausweis- und Zahlungsdaten

**Admin bzw. Content-Editor (später):**

- Provider (Supabase Auth oder Auth.js) wird später entschieden.
- Modell `users ↔ memberships(tenant_id, role)`.
- Berechtigungsprüfung über eine zentrale Policy-Funktion.
- Gast- und Admin-Sessions sind getrennt.

## 8. Content-Modell (GUIDE & EXPLORE)

> **EXPLORE ab Phase 5 implementiert:** siehe [ADR 0009](adr/0009-explore-content-model.md).
>
> **Ab Phase 3 implementiert:** Das GUIDE-Modell ist in [ADR 0007](adr/0007-guide-content-model.md) beschrieben und liegt in `packages/core/src/guide`. Die folgenden Abschnitte bleiben als Planungsgrundlage, die Details stehen im ADR.

**Quelle:**

- Prototyp: Seed-Dateien im Repo (TypeScript, Zod-validiert) → Datenbank.
- Früh danach: ein **einfacher Content-Editor**, siehe Roadmap Phase 9. Er schreibt dieselben Tabellen.

**GUIDE:**

- `GuideCategory`: Icon, Titel, Sortierung, Scope.
- `GuideArticle`: Titel, Kurztext, Bild, `body` als strukturierte **Blocks**: `paragraph`, `heading`, `image`, `list`, `steps`, `callout`, `wifi`, `contact`, `link`, `map`.
- **Scope-Vererbung:** Ein Artikel gehört zu Tenant, Property oder Unit. Bei gleichem `key` überschreibt Unit die Property und Property den Tenant.

**EXPLORE:**

- `ExploreCategory`.
- `Recommendation`: Text, Bilder, Adresse, Geo, Kontakt, Öffnungszeiten (Freitext), persönlicher Tipp.
- `Tag` für querliegende Filter (Familie, Schlechtwetter …).
- n:m-Zuordnung zu Properties.

**UI-Texte vs. Content:**

- UI-Texte liegen in next-intl-Messages.
- Content liegt in der Datenbank als `LocalizedText`.

### 8.1 Zeitabhängige Sichtbarkeit ([ADR 0005](adr/0005-time-based-visibility.md))

Das ist eine bewusst einfache, generische Domain-Abstraktion **ohne Rules Engine**. Jedes sichtbare Content-Element (Guide-Artikel, Block, später Zugangsinfo bzw. Türcode) kann eine optionale `Visibility` tragen:

```ts
type VisibilityBoundary =
  | { type: "absolute"; at: string } // ISO-Zeitpunkt
  | {
      type: "stay";
      anchor: "arrival" | "departure"; // relativ zum Aufenthalt,
      offsetMinutes?: number;
      time?: "HH:mm";
    }; // in der Zeitzone der Property

interface Visibility {
  audience?: "public" | "reservation"; // später: "verified"
  from?: VisibilityBoundary; // ≙ visible_from
  until?: VisibilityBoundary; // ≙ visible_until
}
```

- **Auswertung:** eine reine Funktion `isVisible(visibility, { now, stay?, accessLevel })` in `@up/core`. Sie ist vollständig unit-testbar und nutzt keine Datenbank oder Laufzeit-Regeln.
- Ohne `stay` (öffentlicher Zugriff) sind stay-relative Grenzen nie erfüllt. Solcher Content ist also nie öffentlich sichtbar.
- **Speicherung:** `visibility jsonb NULL`. `NULL` bedeutet immer sichtbar (gemäß Zugriffsstufe).
- **Beispiel Türcode (später, Nuki):**
  - `from: { type: "stay", anchor: "arrival", time: "15:00" }`
  - `until: { type: "stay", anchor: "departure", time: "10:00" }`
  - `audience: "reservation"`
- **Erweiterbar** um weitere Felder (z. B. Wochentage, Saison), ohne das Grundprinzip zu ändern.

## 9. Integrationsarchitektur ([ADR 0003](adr/0003-provider-integrations.md))

> **Ab Phase 4 umgesetzt (vereinfacht):** `PmsProvider` → `ApaleoProvider` lädt eine Reservierung live, ohne lokale Kopie, Webhooks oder Sync. Details in [ADR 0008](adr/0008-pms-provider-apaleo.md). Die unten beschriebene Projektion mit Webhooks und Sync folgt mit der Datenbank.

- **Ports** in `@up/core`: `PMSProvider`, später `AccessProvider`, `GuestRegistrationProvider`, `ExtrasProvider`.
- **Adapter** in `@up/integrations`: `MockPMSProvider`, `ApaleoProvider` (Phase 4).
- Provider-DTOs verlassen den Adapter nie.
- Registry pro Tenant über `integration_connections`. Credentials liegen nur auf dem Server und sind verschlüsselt.
- **Apaleo-Datenfluss:**
  1. Webhook → `webhook_events` (idempotent)
  2. Upsert der lokalen Reservation
  3. Periodischer Abgleich als Sicherheitsnetz (`sync_runs`)
  4. Status in `integration_connections`
- Ein geteilter HTTP-Client sorgt für Timeout, Retry (nur bei idempotenten Calls), strukturiertes Logging und Fehler-Mapping.
- **Extras:** zunächst ein Link aus `ModuleConfig`, ohne Personendaten in der URL.

## 10. i18n

- next-intl mit Locale im Pfad (`/de/…`, `/en/…`).
- Sprachauflösung: explizite Wahl → Sprache der Reservation → `Accept-Language` → Tenant-Default.
- Content-Fallback auf die Default-Sprache des Tenants. Fehlende Übersetzungen werden geloggt.
- Datum und Uhrzeit immer in der Zeitzone der Property.
- Die Anrede („Du“) ist Teil der Messages bzw. des Contents, nicht des Codes.

## 11. Design System

Details, Messwerte und offene Punkte: [design-system.md](design-system.md). Live-Ansicht: `/dev/ui` (nur local und staging).

- `packages/ui/tokens` ist die einzige Stelle mit HEX-Werten. Es gibt Basiswerte und **semantische Tokens**, Komponenten nutzen nur die semantischen.
- Tenant-Branding überschreibt CSS-Variablen serverseitig (Zod-validiert).

**Farben (bestätigt):**

| Token            | Wert      | Einsatz                                                              |
| ---------------- | --------- | -------------------------------------------------------------------- |
| `background`     | `#F8F6F1` | Seitenhintergrund                                                    |
| `card`           | `#F1EDE4` | Flächen, Tiles                                                       |
| `primary`        | `#87977E` | **dekorativ und großflächig** (Akzente, Flächen, große Schrift)      |
| `primary-dark`   | `#52664E` | **Buttons, Links, aktive Navigation, kleine Texte** auf hellem Grund |
| `text`           | `#171817` | Fließtext, Headlines                                                 |
| `text-secondary` | `#6B6A65` | Sekundärtext (minimal abgedunkelt von `#74736E` für WCAG AA)         |
| `border`         | `#E4E0D8` | Linien                                                               |
| `white`          | `#FAFAF7` | Text auf Fotos und dunklen Flächen                                   |

- **Komponenten:** Button, IconButton, InfoTile, ImageCard, HeroCard, StatusCard, SectionHeader, BottomNavigation, FormField, ArticleLayout, EmptyState, ErrorState, Skeleton.
- **Responsive:**
  - Mobile: Bottom Navigation (GUIDE | **STAY** | EXPLORE).
  - Desktop: editoriales Raster mit Top-Navigation, keine gestreckte Mobile-Ansicht.

### 11.1 STAY-Datenfluss (ab Phase 2)

```
StaySource (Mock heute, DB/Apaleo-Projektion später)
   └─ buildStayViewModel(source, locale, now)   reine Funktion, unit-getestet
        ├─ deriveStayPhase()  (@up/core)        pre-arrival | in-house | post-departure
        ├─ Status-Tile: online-check-in (vor Ankunft, Check-in offen) | check-out
        ├─ Datum/Uhrzeit in der Zeitzone der Property (Intl)
        └─ LocalizedText → Text der Locale (Fallback: de)
   └─ StayViewModel → StayHeader · Greeting · StayInfoGrid · StayCards
```

Für den Austausch der Datenquelle ändert sich nur `features/stay/get-stay.ts`.

## 12. Testing

| Ebene       | Werkzeug                                     | Ab Phase |
| ----------- | -------------------------------------------- | -------- |
| Statisch    | tsc strict, ESLint, Prettier                 | 0 ✅     |
| Unit        | Vitest                                       | 0 ✅     |
| Integration | Vitest + echtes Postgres (Tenant-Isolation!) | 3        |
| Contract    | Vitest + Fixtures (Provider)                 | 4        |
| E2E / A11y  | Playwright + axe                             | 8        |

## 13. Security & DSGVO

- Keine Secrets im Client. Externe APIs nur serverseitig (`server-only`).
- Zod an allen Grenzen: Env, Requests, Webhooks, Provider-Antworten.
- Security-Header sind ab Phase 0 aktiv. Eine nonce-basierte CSP folgt in Phase 8.
- Guest-Seiten sind `noindex`.
- Logger mit Redaction sensibler Schlüssel. Keine Personendaten in Logs oder URLs.
- Least Privilege:
  - eingeschränkte DB-Rolle für die App
  - Service Key nur für Migrationen und Seeds
  - Credentials pro Tenant
- Datenminimierung, Aufbewahrungsfristen (Anonymisierung nach Abreise), AVVs mit Vercel und Supabase.

## 14. Roadmap

| Phase | Inhalt                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| **0** | **Foundation**: Monorepo, Tooling, CI, Env-Validierung, minimale App, Doku ✅                                   |
| 1     | **Design System**: Tokens, Fonts, Kernkomponenten, `/dev/ui`                                                    |
| 2     | **STAY statisch** mit Mockdaten, responsive, DE/EN → visuelle Abnahme                                           |
| 3     | **Datenbank + Tenant**: Drizzle-Schema, Migrationen, Seeds, Repositories, Isolationstests                       |
| 4     | **Apaleo-Integration**: `PMSProvider`, `ApaleoProvider`, Webhooks + Abgleich, lokale Reservierungskopie, Status |
| 5     | **Gastzugang + echte personalisierte Reservation**: Token-Link → Session, STAY aus echten Daten                 |
| 6     | **GUIDE**: Kategorien, Artikel, Blocks, Scope-Vererbung, `Visibility`                                           |
| 7     | **EXPLORE** + bestehender Extras-Link                                                                           |
| 8     | **Hardening / Pilot**: Error-, Empty- und Loading-States, A11y-Audit, CSP, Performance, Production              |
| 9     | **Einfacher Content-Editor** für GUIDE und EXPLORE (geschützt, ohne vollständige Admin-App)                     |
| 10+   | Admin-App, Monitoring, Chat, Online-Check-in, Nuki, Feratel, Extras-Integration, AI                             |

> \* Die Reihenfolge wurde angepasst: GUIDE (Struktur mit Mock-Daten) kommt vor Datenbank und Apaleo. Die übrigen Phasen verschieben sich entsprechend.

## 15. Abgrenzung

**Ausdrücklich nicht** (bis zur gesonderten Freigabe): Online-Check-in, Feratel, Nuki, Passscan, Chat, AI, Payments, SaaS-Billing, Customer Onboarding, Subscription Management, weitere PMS-Provider, vollständige Admin-App.
