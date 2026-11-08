# Upselling Phase 2: Extras-Brücke

Stand 08.11.2026. Gäste buchen oder fragen eigene Services direkt in STAY an. Die Extras-App
(`aurelsommerlad/guest-services`) bleibt das einzige Backend für Geschäftslogik, Preise,
Verfügbarkeit, Apaleo-Buchungen und Slack-Freigaben.

## Ablauf

1. STAY-Server → `POST {EXTRAS_BRIDGE_URL}/api/stay/v1/{catalog|overview|order|request|stay-extension}`.
   Die Verbindung läuft nur zwischen den Servern; der Browser sieht weder URL noch Token noch
   Secret.
2. Pro Aufruf ein Token (HS256, 60 s, eindeutige ID), gebunden an Mandant, Apaleo-Property
   (`property.pms.propertyId`) und Apaleo-Reservierung. Alle drei stammen aus dem serverseitigen
   Gastkontext. Weder Nachname noch Reservierungsnummer stehen in einer URL.
3. Extras prüft Token, Einmaligkeit, Mandant und Property (Allow-List) sowie die Zugehörigkeit
   der Reservierung zur Property. Danach führt es die unveränderte Extras-Logik aus:
   - `getGuestCatalog`,
   - `placeGuestOrder` (auch für Zusatzpersonen),
   - `createGuestRequest`,
   - `getStayExtensionOffer` / `confirmStayExtension`.
4. Vor jeder verbindlichen Buchung prüft Extras den Preis neu (`expectedPrice`). Weitere
   Schutzmechanismen:
   - Idempotenzschlüssel pro Bestätigung,
   - Sperre gegen parallele Buchungen derselben Leistung,
   - keine zweite Buchung einer bereits gebuchten Leistung,
   - keine doppelte Anfrage,
   - Rate-Limits und ein Prüfprotokoll ohne Personendaten.

## In STAY

- `features/extras/bridge-client.ts`: Token, Aufrufe, Antwortprüfung (zod). Fehler werden nie
  geraten, sondern als `unavailable` gemeldet.
- `features/upsell/extras-merge.ts`: Extras-Leistungen mit redaktionellem STAY-Inhalt
  (`extrasServiceId`). Leistungen, die es nur in Extras gibt, erscheinen mit Name und
  Beschreibung aus Extras. Die Verlängerungsnacht ist eine eigene Seite.
- `features/extras/booking-service.ts` und `actions.ts`: Buchung, Anfrage, Verlängerung.
  Zusätzlich ein eigenes Rate-Limit und die Erfassung des zuordenbaren Umsatzes als Tagessumme.
- `v2/upsell/V2ExtrasBooking.tsx`: verbindlicher Preis, Menge, Kennzeichen, Ergebnis.
- „Gebucht & angefragt“ zeigt:
  - Leistungen auf der Reservierung (Apaleo, jede Quelle),
  - Zusatzpersonen (Bestellprotokoll von Extras),
  - Anfragen mit Extras-Status (angefragt, bestätigt, nicht möglich),
  - Verlängerungen.

  Stornierte Leistungen fehlen, weil Apaleo entfernte Leistungen nicht vorhält.

## Freischaltung

- **STAY:** `EXTRAS_BRIDGE_URL` + `EXTRAS_BRIDGE_SECRET` und `extras: "bridge"` an der Property.
  Das ist nur für Testobjekte mit V2 und `upsell: "v1"` möglich, derzeit also nur für `test-run`.
  Ohne diese Einstellungen bleibt Phase 1 aktiv (Link zur Extras-App).
- **Extras:** `STAY_BRIDGE_ENABLED`, `STAY_BRIDGE_SECRET`, `STAY_BRIDGE_TENANT`,
  `STAY_BRIDGE_PROPERTY_IDS` (Staging: `TEST`). Ohne diese Werte antworten alle Routen mit 404.
- Das Deployment der Brücke und der erste echte Buchungsversuch brauchen eine ausdrückliche
  Freigabe.
