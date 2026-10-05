# 0007 – GUIDE-Content-Modell

**Status:** Akzeptiert (Phase 3). Implementiert in `packages/core/src/guide`, Mock-Daten in `apps/guest/src/mocks/guide`.

## Kontext

Die digitale Gästemappe (GUIDE) soll später aus der Datenbank bzw. einem einfachen Content-Editor gespeist werden. Inhalte gelten für einen Tenant, eine Property oder ein einzelnes Apartment, und manche Inhalte sind nur zeitweise sichtbar (z. B. ein Türcode). Wir wollen weder einen Page Builder noch einen Rich-Text-Editor und auch keine Rules Engine.

## Entscheidung

- **Eine `GuideSection` pro Thema**, so geformt wie eine spätere Tabellenzeile:
  - Identität und Zuordnung: `id`, `tenantId`, `key`, `scope`, `status`
  - Lokalisierte Felder als `LocalizedText`: `slug`, `eyebrow`, `title`, `shortDescription`, `intro`
  - Darstellung: `icon`, `sortOrder`, optional `heroImage`
  - Sichtbarkeit: optional `visibility`
  - Inhalt: `blocks` (geordnetes JSON-Array)
- **Blöcke**, bewusst wenige:
  - `heading`, `paragraph`
  - `list` (Aufzählung oder Schritte)
  - `callout` (Hinweis)
  - `image`, `link`
  - `action` (Telefon, E-Mail, Karte)
  - Jeder Block hat eine `id` und optional eine eigene `visibility`.
- **Scope:** `tenant` | `property` (`propertyId`) | `unit` (`propertyId`, `unitId`).
  - Heute wird nur gefiltert: Ein Inhalt gilt, wenn sein Scope zur Property bzw. zum Apartment des Gastes passt.
  - **Vorbereitet ist die Vererbung** Tenant-Standard → Property → Unit: Sections zum selben Thema teilen sich einen `key`, später gewinnt der spezifischste Scope. Diese Logik ist noch nicht gebaut.
- **Sichtbarkeit:** siehe ADR 0005 (`isVisible`). Sie wirkt auf Sections und auf einzelne Blöcke.
- **Auswahl:** `selectGuideSections(sections, context)` liefert nur veröffentlichte Sections des richtigen Tenants, mit passendem Scope und aktuell sichtbar, sortiert nach `sortOrder`.
- **Darstellung:** Die App löst Inhalte pro Locale in ViewModels auf (`features/guide/resolve-guide.ts`) und rendert Blöcke mit `GuideBlocks`. Slugs sind lokalisiert (`/de/guide/ankunft-parken`, `/en/guide/arrival-parking`).

## Konsequenzen

- Ein späterer Editor schreibt genau diese Struktur. Die Datenbank speichert eine Zeile pro Section, Blöcke als `jsonb`.
- Neue Blocktypen werden additiv ergänzt: Typ, Resolver und Renderer. Bestehende Inhalte bleiben gültig.
- Bilder werden als URL mit Abmessungen referenziert. Heute sind das gebündelte Assets, später Storage-URLs.
