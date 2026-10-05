# 0009 – EXPLORE-Content-Modell

**Status:** Akzeptiert (Phase 5). Implementiert in `packages/core/src/explore`, Mock-Inhalte in `apps/guest/src/mocks/explore`.

## Kontext

EXPLORE zeigt Orte, die UNIQUE PLACES selbst empfiehlt. Die redaktionelle Auswahl ist das Produkt, keine vollständige Liste. Inhalte sollen später aus unserer Datenbank bzw. einem Editor kommen, ohne externe Places-API.

## Entscheidung

- **`ExplorePlace`**, so geformt wie eine spätere Tabellenzeile:
  - Identität und Zuordnung: `id`, `tenantId`, `scope`, `status`
  - Lokalisierte Felder: `slug`, `title`, `shortDescription`, `recommendation` (persönliche Empfehlung), `description` (Absätze), `goodToKnow`, `openingHours` (Freitext)
  - Klassifizierung: `categories` (Hauptkategorie zuerst, mehrere möglich)
  - Medien: `images` (erstes Bild = Titelbild)
  - Optional: `address`, `coordinates`, `website`, `phone`, `bookingUrl`
  - Sortierung und Sichtbarkeit: `sortOrder`, `featured`, `visibility`
- **Kategorien** sind zentral und typisiert: `EXPLORE_CATEGORIES` = food-drink, nature, active, culture, family. Der Filter `all` kommt hinzu. Die Labels stehen in den App-Messages (DE/EN). Eine neue Kategorie heißt: ein Eintrag plus zwei Labels.
- **Scope:** `tenant` oder `properties` mit einer **Liste** von Property-IDs. Ein Ort kann so mehreren Properties zugeordnet sein (geplante Tabelle `place_properties`). Es gibt keine Vererbungslogik.
- **Auswahl:** `selectExplorePlaces()` liefert nur veröffentlichte Orte des richtigen Tenants, mit passendem Scope und aktuell sichtbar. Hervorgehobene Orte kommen zuerst, danach die Sortierung. `filterPlacesByCategory()` passt, sobald eine der Kategorien eines Orts zutrifft.
- **Aktionen** (`buildPlaceActions`): Route, Website, Anrufen, Reservieren. Jede Aktion erscheint nur, wenn die Information vorhanden ist.
  - Die Route ist ein externer Kartenlink (Koordinaten bevorzugt, sonst die Adresse). Es gibt keine Maps-API.
  - Reservieren verlinkt nur die angegebene URL. Es gibt keine Buchungsintegration.
- **Bewusst nicht im Modell:** Bewertungen, Sterne, Entfernungen, Favoriten.

## Konsequenzen

- Ein späterer Editor pflegt genau diese Felder. Optionale Felder bleiben leer, ohne dass die Darstellung bricht.
- Entfernungen oder strukturierte Öffnungszeiten können additiv ergänzt werden.
