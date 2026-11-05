# 0020 – Design V2 „Editorial“ als getrennte Designversion

**Status:** Entwurf zur Freigabe (2026-11-05). Gilt nur für die drei V2-Ansichten Startseite, Online-Check-in und Apartment & Zugang.

## Kontext

Eine zweite, eigenständige Gestaltung der Gästemappe soll sich so genau wie möglich an einer Editorial-Referenz orientieren. Die bestehende App bleibt unverändert und muss unabhängig davon funktionieren. APIs, Datenmodelle, Authentifizierung und Geschäftslogik werden nicht dupliziert.

## Entscheidung

**Trennung über die Route:**

| Teil        | Ort                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seiten      | `apps/guest/src/app/[locale]/(v2)/v2/…`: `/v2`, `/v2/check-in`, `/v2/check-in/[step]`, `/v2/apartment`                                                   |
| Layout      | eigene Hülle mit eigener Navigation (`(v2)/v2/layout.tsx`), nicht das Layout der bestehenden App                                                         |
| Komponenten | `apps/guest/src/v2/` (`components/`, `check-in/`)                                                                                                        |
| Styles      | `apps/guest/src/v2/styles/tokens.css` (einzige Datei mit V2-Rohwerten, im Token-Guard freigegeben) und `v2.css` (nur `v2-`-Klassen, wirksam unter `.v2`) |
| Schrift     | Nunito Sans (next/font, selbst gehostet), nur im V2-Layout geladen                                                                                       |

**Gemeinsam genutzt, nicht dupliziert:**

- Session und Gastkontext (`requireGuestContext`).
- `getStay` und das View-Model, inklusive der Kachel-Logik `selectTiles`. Beide Designs zeigen dadurch immer denselben echten Zustand.
- Zugangsregeln und die Server Action `revealAccessCode`.
- Check-in-Service, Formularmodell und Validierung.
- Die Server Actions des Check-ins sind in `features/check-in/action-handlers.ts` zusammengefasst. Die bestehende App (`/check-in`) und V2 (`/v2/check-in`) rufen dieselben Handler auf. Sie unterscheiden sich nur im festen Rücksprungziel, das nie aus Eingaben kommt.

**Kleine, rein additive Änderungen an gemeinsamem Code:**

- `StayViewModel.times`: Check-in- und Check-out-Zeit für die Apartmentseite.
- Die Check-in-Actions delegieren an die Handler. Ihr Verhalten ist unverändert.

**Navigation:** GUIDE und EXPLORE führen vorerst auf die bestehenden Seiten. Weitere V2-Seiten entstehen erst nach Freigabe.

**Ausgangspunkt:** Commit `c847b9b` (lokaler Tag `v1-vor-v2`). V2 ist rein additiv. Zum Entfernen reicht es, `(v2)` und `src/v2` zu löschen.

## Design-Tokens (gemessen an der Referenz, 390 pt)

**Farben:**

- Papier `#F5EFE9`, Navigation `#F8F3EE`
- Tinte `#1D1C19`
- Oliv-Akzent `#5B5A36` für Statusmarken
- Haarlinien `#CFC8BF` und `#958F89`

**Typografie (Nunito Sans):**

- Begrüßung 32 / 34, Light
- Untertitel 16,5, Light
- Kleine Versalüberschriften 10,5 mit +0,3 em Laufweite
- Bildtitel 21,5 bzw. 16, Light

**Raster:**

- Textrand 31 px, Fotorand 16 px, Fotoabstand 7 px
- Hauptfoto 359 : 204, Halbbilder 177 : 129
- Aktive Navigation: schwarzer Kreis 46 px

**Formen:** keine Rundungen, keine Schatten, Linien statt Flächen.

## Konsequenzen

- Beide Designs laufen parallel und unabhängig voneinander. Änderungen an Logik oder Daten wirken in beiden.
- Abweichungen von der Referenz sind bewusst:
  - Vor der Anreise steht der echte Begrüßungstext („… bald bei uns bist.“, dadurch drei Zeilen).
  - Die Fotos sind die vorhandenen Platzhalter.
  - Das UP-Monogramm ist nachgezeichnet, bis das offizielle Logo als SVG vorliegt.
