# 0015 – EXPLORE-Content-Management in der Datenbank

**Status:** Akzeptiert (2026-10-06, Phase 10). Löst die Mock-Daten aus [ADR 0009](0009-explore-content-model.md) ab.

## Kontext

EXPLORE ist der kuratierte lokale Guide: wenige, persönlich ausgewählte Empfehlungen von UNIQUE PLACES rund um ein Objekt – keine touristische Datenbank. Bisher lagen fiktive Beispielorte im Code. Empfehlungen sollen im Admin gepflegt und Objekten zugeordnet werden. Anders als GUIDE-Themen gehören sie nicht zu genau einem Objekt: Ein Ausflugsziel kann für mehrere Objekte passen.

## Entscheidung

**Eigenes Datenmodell, keine Kopie von GUIDE:**

- `explore_places`: eine Empfehlung eines Tenants. Lokalisierte Felder als `jsonb` `{ de, en? }`: `slug`, `title`, `teaser` (Pflicht), `description`, `tip` („Unser Tipp“), `opening_hours` (redaktioneller Hinweis). Dazu `hero_image` (ein Titelbild), `address` (mehrzeilig), `locality` (Ort auf der Karte), `maps_url`, `website_url`, `phone`, `reservation_url`, `sort_order`, `featured` (Highlight), `status`, `source_locale`, `translation_state`, `first_published_at`.
- `explore_place_properties`: Zuordnung Empfehlung ↔ Objekt (n:m). Beide Fremdschlüssel enthalten `tenant_id` (`(tenant_id, place_id)` → `explore_places`, `(tenant_id, property_id)` → `properties`). Eine Zuordnung zu einem Objekt eines anderen Tenants ist damit in der Datenbank unmöglich. Keine Property-IDs als JSON-Liste.
- **Keine automatische Tenant-weite Anzeige:** Eine Empfehlung ohne Zuordnung erscheint nirgends.
- Check-Constraints: Status, Kategorie, Quellsprache, Pflichttexte (DE), Links nur `http(s)`, Telefonformat, Längen. RLS aktiv ohne Policies; `anon`/`authenticated` ohne Rechte (Migration `0007`).
- Kein Unit-Bezug, keine zeitabhängige Sichtbarkeit, keine Galerie (bei Bedarf additiv).

**Kategorien:** feste, zentrale Taxonomie in `@up/core` (`EXPLORE_CATEGORIES`) plus Check-Constraint: `food-drink` (Essen & Trinken), `nature` (Natur & Ausflüge), `activities` (Aktivitäten), `wellness` (Baden & Wellness), `shopping` (Einkaufen), `sights` (Sehenswertes). Eine Kategorie pro Empfehlung. Ein Kategorien-CMS bringt heute keinen Nutzen; eine neue Kategorie ist ein Eintrag, eine Migration für den Check und zwei Labels.

**Status, Sortierung, Übersetzung:** wie GUIDE – `draft | published | archived`, Speichern ist bei veröffentlichten Empfehlungen sofort live, nie veröffentlichte können gelöscht werden. Reihenfolge über `sort_order` (Pfeile im Admin, bezogen auf die aktuelle Ansicht), Highlights zuerst. `translation_state.en` = `reviewed`, wenn alle deutschen Texte eine englische Fassung haben, sonst `missing` (vorbereitet für `machine`/`outdated`). Fehlt EN, zeigt die App DE – keine erfundene Übersetzung.

**Guest App:** liest über `listPublishedExplorePlaces` (tenant-scoped, nur `published`, nur dem Objekt des Guest Context zugeordnet) und prüft die Auswahl zusätzlich in `@up/core` (`selectExplorePlaces`). Kein Apaleo-Aufruf für EXPLORE. Kategoriefilter nur für Kategorien mit Inhalten. Aktionen (Route, Website, Anrufen, Reservieren) nur, wenn die Angabe existiert; Route = gepflegter Kartenlink, sonst Kartensuche mit der Adresse. Ohne Empfehlungen: ruhiger Hinweis statt Beispielinhalten.

**Admin:** Modul „Explore“ unter „Inhalte“. Bei „Alle Objekte“ zeigt es alle Empfehlungen des Tenants mit Zuordnung (Registry-Scope `aggregate`), bei einem Objekt dessen Empfehlungen. Editor-URLs behalten den Kontext (`/explore/<objekt>/<id>` bzw. `/explore/places/<id>`). Zuordnung per Checkboxen mit Name und Ort; der Server prüft jede ID gegen die Objekte des Tenants.

**Medien:** dieselbe Signed-Upload-Infrastruktur und derselbe Bucket wie GUIDE. Der Pfad ist tenant-weit, weil eine Empfehlung mehreren Objekten dienen kann: `<tenantId>/explore/<uuid>.<ext>` (GUIDE bleibt `<tenantId>/<propertyId>/guide/<uuid>.<ext>`). Der Bucket-Name `guide-media` ist historisch; ein neuer Bucket brächte heute nur Migrationsaufwand. Er ist über `GUIDE_MEDIA_BUCKET` konfigurierbar, falls später ein neutraler Name gewünscht ist.

**Fixtures:** fiktive Beispielorte nur lokal (`pnpm db:seed --target local --with-explore-fixtures`) und in Tests.

## Konsequenzen

- Empfehlungen sind ohne Deployment pflegbar und je Objekt kuratierbar.
- Entfernungen, strukturierte Öffnungszeiten, Galerien oder Places-APIs lassen sich additiv ergänzen; heute bewusst nicht gebaut.
- Die Sortierung ist tenant-weit; das Verschieben in einer Objekt-Ansicht tauscht mit dem Nachbarn dieser Ansicht.
