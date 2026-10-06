# Design System – UNIQUE PLACES Guest App

Stand: Phase 5 (EXPLORE). Dieses Dokument beschreibt das aus den Referenzen abgeleitete Designsystem und wie es technisch umgesetzt ist.

> **Die Referenzbilder bleiben die visuelle Source of Truth.** Dieses Dokument übersetzt sie in reproduzierbare Regeln.
>
> - **PRIMARY DESIGN REFERENCE:** STAY-Startseite (`01_PRIMARY_stay-design-reference.png`). Sie ist verbindlich für Gesamtwirkung, Typografie, Weißraum, Proportionen, Cards, Bildwirkung, Navigation, Farbe, Radien und Ruhe.
> - **SECONDARY DESIGN REFERENCE:** weitere Seitentypen (`02_SECONDARY_guest-app-pages-reference.png`). Sie dient nur zur Ableitung wiederkehrender Muster. Bei Widerspruch gilt die PRIMARY.

**Kennzeichnung**

- **A**: klar aus der Referenz erkennbar bzw. gemessen
- **B**: technisch sinnvoll abgeleitet
- **C**: noch nicht eindeutig entschieden, Entscheidung nötig

## 0. Methode

- **Maßstab:** Der Screen-Inhalt der PRIMARY-Referenz ist ca. 604 px breit und entspricht einem iPhone mit **390 pt**. 1 pt entspricht ca. 1,55 px im Bild. Alle Werte unten sind in CSS-px bzw. pt bei 390 pt Breite angegeben.
- **Typografie objektiv kalibriert:**
  1. Josefin Sans und Roboto wurden im Browser gerendert.
  2. Gesucht war die Schriftgröße, bei der die Zeilenbreite der Referenz entspricht.
  3. Gegenprüfung über die gemessene Versalhöhe (Josefin Sans: Versalhöhe 0,72 em, x-Höhe 0,40 em; Roboto: 0,71 em bzw. 0,54 em).
- **Gegenprobe:** Die Kompositionsprobe im Design Lab (`/dev/ui/frame`) wurde bei 390 px Breite neben die Referenz gelegt und Messpunkt für Messpunkt abgeglichen (Abstände, Höhen, Zeilenumbrüche).

## 1. Gesamtwirkung (A)

- Ruhige, warme, papierartige Fläche (Sand) mit sehr wenigen UI-Elementen.
- Hierarchie entsteht über **Größe und Weißraum**, nicht über Farbe, Linien oder Schatten.
- Eine große, leichte Headline trägt die Seite. Alles Weitere ordnet sich darunter in **wenigen, klaren Blöcken** an: Info-Tiles, dann Foto-Cards.
- Fotografie ist großformatig und warm, mit Text direkt im Bild.
- Akzentfarbe Salbei erscheint **einmal** als Fläche (Apartment-Tile), nicht als Dekoration überall.
- **Kein** Dashboard-Raster, keine Badges, keine Trennlinien zwischen Inhalten, keine Card-Schatten.

## 2. Farben

### Basiswerte (A, vorgegeben)

| Token            | Wert      | Rolle                                             |
| ---------------- | --------- | ------------------------------------------------- |
| `background`     | `#F8F6F1` | Seitenhintergrund                                 |
| `card`           | `#F1EDE4` | Tiles, Cards                                      |
| `primary`        | `#87977E` | Charakteristische Farbfläche: groß, dekorativ     |
| `primary-dark`   | `#52664E` | Links, kleine Akzenttexte                         |
| `text`           | `#171817` | Headlines, Fließtext                              |
| `night`          | `#17160F` | Primäre Call-to-Action-Buttons                    |
| `text-secondary` | `#6B6A65` | Sekundärtext (von `#74736E` abgedunkelt, WCAG AA) |
| `border`         | `#E4E0D8` | Haarlinien, Outline-Buttons                       |
| `white`          | `#FAFAF7` | Text auf Fotos und Akzentflächen, gehobene Cards  |

### Semantische Rollen (B)

Komponenten verwenden ausschließlich semantische Tokens:

| Semantischer Token | Basis          | Einsatz                                                    |
| ------------------ | -------------- | ---------------------------------------------------------- |
| `background`       | background     | Seite                                                      |
| `surface`          | card           | Standard-Tile/-Card (Check-out-Tile)                       |
| `surface-raised`   | white          | Listen-Cards (SECONDARY), Kreis-Buttons auf Fotos          |
| `surface-accent`   | primary        | Salbei-Fläche (Apartment-Tile, Check-out-Abschluss)        |
| `surface-inverse`  | text           | Hervorgehobener Navigationspunkt (STAY-Kreis)              |
| `text`             | text           | Primärtext                                                 |
| `text-muted`       | text-secondary | Subline, Datum, Ort im Header                              |
| `text-inverse`     | white          | Text auf Fotos und Ink                                     |
| `on-accent`        | text           | Text auf der Salbei-Fläche (AA, Phase 2)                   |
| `cta`              | night          | Primäre Buttons (gefüllt), gefüllter „+“-Kreis             |
| `cta-hover`        | night + white  | Hover von `cta` (16 % aufgehellt)                          |
| `on-cta`           | white          | Text auf `cta`                                             |
| `action`           | primary-dark   | Links, kleine Akzenttexte                                  |
| `border`           | border         | Linien                                                     |
| `focus`            | primary-dark   | Fokusrahmen                                                |
| Overlay            | text (Alpha)   | Verlauf auf Fotos (unten ca. 62 %, Mitte ca. 28 %, oben 0) |

### Kontraste (gemessen, WCAG 2.2)

| Paar                                 | Verhältnis | Ergebnis              |
| ------------------------------------ | ---------- | --------------------- |
| text / background                    | 16,5       | AAA                   |
| text-secondary / background          | 5,0        | AA                    |
| text-secondary / card                | 4,6        | AA                    |
| primary-dark / background            | 5,8        | AA                    |
| white / night (Button)               | 17,4       | AAA                   |
| white / night-hover (Button, Hover)  | 10,8       | AAA                   |
| white / ink (STAY)                   | 17,0       | AAA                   |
| **white / primary (Apartment-Tile)** | **3,0**    | **nur große Schrift** |

Im Design Lab werden diese Werte live aus den Tokens berechnet.

## 3. Typografie

**Familien (A, vorgegeben):**

- Josefin Sans für Headlines, Labels, Kennzahlen und Navigation.
- Roboto für Fließtext und Sekundärinformationen.

**Implementierung (B):**

- `next/font/google`, selbst gehostet: Die Dateien werden beim Build geladen und von der eigenen Domain ausgeliefert. Es gibt keine Requests an Google zur Laufzeit (DSGVO).
- Beide Schriften als **Variable Fonts**, also eine Datei pro Subset für alle Gewichte.
- Subsets `latin` und `latin-ext` (z. B. „Ū“ in HŪSLE).
- `display: swap`, CSS-Variablen `--font-josefin` und `--font-roboto`.

### Typo-Rollen

Die Werte gelten bei 390 pt Breite. „Kalibriert“ ist der Messwert aus Zeilenbreite bzw. Versalhöhe.

| Rolle (`type-*`) | Familie | Größe / Zeilenhöhe            | Gewicht               | Tracking  | Kalibriert                                | Einsatz                                    | Status         |
| ---------------- | ------- | ----------------------------- | --------------------- | --------- | ----------------------------------------- | ------------------------------------------ | -------------- |
| `display`        | Josefin | **32 / 36** (Desktop 44 / 48) | 350 (Phase 2)         | 0         | 30,8–31,5 px · Zeilenabstand 36 pt        | Begrüßung                                  | A (Desktop: B) |
| `title-lg`       | Josefin | 28 / 32 (Desktop 36)          | 350 (Phase 2)         | 0         | –                                         | Seitentitel (SECONDARY)                    | B              |
| `title`          | Josefin | **17 / 22**                   | Regular 400           | 0         | 17,0 px                                   | Titel auf Foto-Cards                       | A              |
| `figure`         | Josefin | **32 / 32**                   | 350 (Phase 2)         | 0         | 28,5–34,1 px (Ø 31)                       | „10:00“, „ROS“                             | A              |
| `brand`          | Josefin | **13 / 18**                   | Regular 400           | +0,02 em  | 12,2–13,0 px                              | „HØV · Altusried“                          | A              |
| `eyebrow`        | Josefin | **11 / 14**, VERSAL           | Regular 400           | +0,03 em  | Versalhöhe 8 pt → 11 px                   | „CHECK-OUT“, „APARTMENT“                   | A/C (siehe C3) |
| `nav`            | Josefin | 11 / 13, VERSAL               | SemiBold 600          | +0,04 em  | Versalhöhe 7,4 pt → 10,3 px               | GUIDE · STAY · EXPLORE                     | A              |
| `lead`           | Roboto  | **15 / 19,5**                 | Regular 400 (Phase 2) | 0         | 14,4–14,5 px · Zeilenabstand 18,7 pt      | Subline unter Begrüßung                    | A              |
| `body`           | Roboto  | 15 / 22,5                     | Regular 400           | 0         | –                                         | Fließtext, Artikel                         | B              |
| `small`          | Roboto  | **14 / 19,6**                 | Regular 400           | 0         | 12,6–12,7 px Breite; Versalhöhe → 13,6 px | Datum, „Details ansehen“, Card-Sublines    | A/B (siehe C4) |
| `caption`        | Roboto  | 13 / 18                       | Regular 400           | +0,005 em | –                                         | Listenbeschreibungen, Hinweise (SECONDARY) | B              |

**Weitere Regeln:**

- **Leichte Headlines (A):** Groß und Light, nie fett. Die Hierarchie entsteht über Größe.
- **Ausbalancierter Umbruch (A):** Die Referenz bricht Sublines in gleich lange Zeilen um („Wir wünschen Dir einen / wunderbaren Aufenthalt.“, „Mach Deinen Aufenthalt / noch schöner“). Umgesetzt mit `text-wrap: balance` und einer begrenzten Breite.
- **Headlines (B):** Headings nutzen ebenfalls `text-balance`.
- **Mindestgrößen (B):** Fließ- und Sekundärtext nicht unter 13 px, Versal-Labels nicht unter 11 px.

## 4. Abstände & Raster

Gemessen in pt bei 390 pt Breite:

| Abstand                                    | Referenz           | Token / Umsetzung                       | Status |
| ------------------------------------------ | ------------------ | --------------------------------------- | ------ |
| Horizontaler Seitenrand (Text)             | ~21 pt             | `gutter` = 20 px                        | A      |
| Horizontaler Seitenrand (Cards)            | ~18 pt             | Cards sitzen auf demselben 20-px-Raster | B (C5) |
| Header-Mitte → Versalhöhe Begrüßung        | ~52 pt             | Header 44 px + `mt-6` (24 px)           | A      |
| Begrüßung → Subline                        | ~12 pt Box-Abstand | `gap-3` (12 px)                         | A      |
| Subline → Tiles                            | ~20 pt             | `gap-5` (20 px)                         | A      |
| Tile ↔ Tile                                | ~8 pt              | `gap-2` (8 px)                          | A      |
| Tiles → erste Foto-Card                    | ~12 pt             | `mt-3` (12 px)                          | A      |
| Foto-Card ↔ Foto-Card                      | ~8 pt              | `gap-2` (8 px)                          | A      |
| Tile-Innenabstand                          | ~16 pt             | `p-4` (16 px)                           | A      |
| Text auf Foto: links / unten               | ~15 / ~12 pt       | `px-4` / `pb-3`                         | A      |
| Label-Zeile → Kennzahl → Datum (Baselines) | 26 / 23 pt         | `gap-4` / `gap-1`                       | A      |

**Prinzip (A):** Großzügig nach außen, eng innerhalb von Gruppen. Zusammengehörige Elemente liegen 8 px auseinander, Gruppen 12 px, Abschnitte 24–40 px und mehr.

**Raster (B):**

- 4-px-Basisraster (`--spacing: 0.25rem`).
- Benannte Layout-Abstände: `gutter` 20 px, `gutter-md` 32 px, `gutter-lg` 48 px, `touch` 44 px.

## 5. Formen

| Element                 | Referenz          | Token                               | Status    |
| ----------------------- | ----------------- | ----------------------------------- | --------- |
| Tile-/Card-Radius       | ~9 pt             | `radius-card` = 10 px               | A (±1 px) |
| Bildradius (Foto-Cards) | ~8–9 pt           | `radius-card` = 10 px               | A         |
| Kreis-Button auf Foto   | Ø ~37 pt          | 40 px sichtbar, 44 px Trefferfläche | A/B       |
| STAY-Hervorhebung       | Ø ~63 pt          | `radius-full`, 64 px (Phase 2)      | A         |
| Button-Radius           | (SECONDARY) klein | `radius-control` = 8 px             | B/C       |
| Badges/Chips            | (SECONDARY)       | `radius-sm` = 6 px                  | B         |

### Bild-Seitenverhältnisse (A)

| Element             | Maße         | Verhältnis | Token                           |
| ------------------- | ------------ | ---------- | ------------------------------- |
| Erste Foto-Card     | 353 × 161 pt | 2,2 : 1    | `aspect-photo-feature` = 11 : 5 |
| Folgende Foto-Cards | 353 × 127 pt | 2,75 : 1   | `aspect-photo` = 11 : 4         |
| Desktop             | –            | 4 : 3      | einheitlich (B)                 |

### Schatten (A)

- **Bewusster Verzicht.** Tiles, Cards und Bilder sind flach und trennen sich nur durch Tonwert.
- `shadow-float` ist nur für künftige schwebende Elemente (Sheets, Toasts) definiert (B).

### Bewegung (B)

- Dauern: 150 ms (Hover), 250 ms (Standard), 400 ms (Übergänge).
- Easing: ruhiges Ease-out `cubic-bezier(0.22, 1, 0.36, 1)`.
- `prefers-reduced-motion` deaktiviert Animationen systemweit.

## 6. Icons

- **Stil (A):** feine Outline-Icons, ca. 1,5 px Strich, runde Enden, ohne Füllung.
- **Größen (A/B):** 16 px (Tiles, Inline-Pfeile), 20 px (Header, Kreis-Buttons), 24 px (Navigation, STAY).
- **Glyphengröße (A):** Das Glyph füllt ca. 75–85 % der Box. Gemessen: Tile-Icons ca. 15 pt, Glocke ca. 19 pt, Navigation ca. 21–25 pt, Pfeil im Kreis ca. 12 pt.
- **Umsetzung (B):** Eigenes, kuratiertes Set als Inline-SVG in `@up/ui`, Geometrie von Lucide (ISC-Lizenz, Hinweis liegt bei). Keine Icon-Library als Dependency.
- **Barrierefreiheit:** Dekorative Icons sind `aria-hidden`. Icon-only-Buttons verlangen ein `label`.

## 7. Navigation (A, umgesetzt in Phase 2)

- Drei Punkte: GUIDE | **STAY** | EXPLORE. STAY sitzt mittig in einem dunklen Kreis (Ink, Ø ca. 64 px) mit Icon und Label in Weiß.
- GUIDE und EXPLORE: Outline-Icon (ca. 22 px) über einem Versal-Label (`type-nav`), Farbe Ink.
- Navigationsleiste auf `background`, mit Haarlinie (`border`) nach oben. Keine Schatten, keine Unterstreichung.
- Safe Area (Home-Indicator) wird freigehalten.

## 8. Komponenten-Muster

- **Info-Tile (A, Phase 2):**
  - `surface` bzw. `surface-accent`, Radius `card`, Padding 16 px.
  - Zeile aus Icon und `eyebrow`, darunter `figure`, darunter `small` (muted bzw. inverse).
  - Zwei Tiles stehen nebeneinander, mit 8 px Abstand.
- **Foto-Card (A, Phase 2):**
  - Vollflächiges Bild mit Verlauf von unten.
  - `title` und `small` unten links in `text-inverse`.
  - Kreis-Pfeil-Button (`surface-raised`) unten rechts.
  - Die ganze Card ist klickbar.
- **Text-Link (A):** „Details ansehen →“ als `small` mit 16-px-Pfeil. Erbt die Farbe vom Kontext.
- **Aus SECONDARY abgeleitete Muster (B, spätere Phasen):**
  - Listen-Cards (Icon, Titel, Beschreibung, Chevron) auf `surface-raised`
  - Zurück-Pfeil mit Breadcrumb
  - Seitentitel in `title-lg` mit Lead
  - Info-Hinweis-Box auf `surface`
  - Primär- und Outline-Button nebeneinander
  - runder „+“-Button (`cta`)
  - Abschluss-Banner auf `surface-accent`

## 9. Responsive-Prinzipien (B)

- **Mobile First.** Die Referenz definiert Smartphone (390 pt).
- **Breakpoints:** `sm` 480 · `md` 768 (Tablet) · `lg` 1024 (Desktop) · `xl` 1280.
- **Tablet:** Der Seitenrand wächst auf 32 px. Foto-Cards stehen teilweise zweispaltig.
- **Desktop:** eigenes editoriales Layout, keine gestreckte Mobile-Ansicht.
  - Inhaltsbreite max. 1040 px (`content`), Seitenrand 48 px.
  - Begrüßung (7/12) neben Tiles (5/12).
  - Foto-Cards dreispaltig in 4 : 3.
  - Display-Schrift 44 px.
- **Lesbreite für Artikel:** max. 640 px (`reading`).
- **Navigation auf Desktop:** voraussichtlich Top-Navigation (C7).

## 10. Barrierefreiheit (B)

- Semantik und Optik sind getrennt: `Heading level` bestimmt die Gliederung, `variant` die Optik.
- Einheitlicher, gut sichtbarer Fokusrahmen (2 px `focus`, 3 px Abstand) über `:focus-visible`.
- Touch-Ziele mindestens 44 × 44 px. Kleine Kreise vergrößern ihre Trefferfläche unsichtbar.
- Kontraste nach Abschnitt 2. Weiß auf Salbei nur für große Schrift (siehe C1).
- `prefers-reduced-motion` wird respektiert.

## 11. Technische Umsetzung

```
packages/ui/src/styles/tokens.css   ← EINZIGE Stelle mit Rohwerten (Farben, Radien, Breiten …)
packages/ui/src/styles/theme.css    ← Tailwind v4 @theme: Default-Theme komplett entfernt,
                                       nur Tokens als Utilities; Typo-Rollen als @utility type-*
packages/ui/src/styles/base.css     ← Body, Fokus, Selection, reduced motion
packages/ui/src/tokens/catalog.ts   ← Namen & Rollen für Dokumentation (keine Werte)
packages/ui/src/primitives/         ← Text, Heading, Container, Stack, Surface
packages/ui/src/icons/              ← Icon + kuratiertes SVG-Set
packages/ui/src/components/         ← Button (+ buttonStyles), IconButton
apps/guest/src/app/fonts.ts         ← next/font (Josefin Sans, Roboto)
apps/guest/src/app/dev/ui           ← Design Lab (nur local/staging)
scripts/check-design-tokens.mjs     ← Guard: keine HEX-Werte/Arbitrary Values außerhalb der Tokens
```

**Regeln:**

1. **Keine Rohwerte in Komponenten.** HEX-Farben und Tailwind-Arbitrary-Values (`bg-[#…]`, `p-[13px]`) bricht `pnpm lint` ab.
2. **Nur Token-Utilities.** Das Tailwind-Default-Theme ist entfernt. `bg-red-500` oder `text-xl` erzeugen daher nichts.
3. **Tenant-Branding:** Tenants überschreiben `--up-*`-Variablen auf `:root`. Utilities referenzieren die Variablen direkt (`@theme inline`), deshalb ist kein Build nötig.
4. **Komponenten statt Nachbauten.** Neue Screens verwenden die Primitives und Komponenten aus `@up/ui`.

## 12. Änderungen in Phase 2 (STAY-Startscreen)

- **Typografie:**
  - Display, Title Large und Figure in Josefin **350** statt 300. Die Begrüßung wirkt damit nicht mehr filigran und bleibt auf dem Smartphone gut lesbar.
  - Lead (Subline) in Roboto **400**.
  - Display auf Smartphones unter 360 px **28 px**, damit die Zeilenumbrüche der Begrüßung erhalten bleiben.
  - Neue Rolle `type-wordmark`, Navigations-Labels in 500.
- **Neuer Farb-Token `on-accent`:** Text auf der Salbei-Fläche, Ink (AA). Siehe C1.
- **Neue Layout-Tokens:**
  - Breakpoint `xs` (360 px)
  - `nav-bar` (72 px), `nav-active` (64 px), `container-nav` (416 px)
  - Utilities `safe-top`, `safe-bottom`, `clear-bottom-nav`, `glyph-flip-y`
- **Foto-Overlay sanfter:** 55 % bzw. 22 % statt 62 % bzw. 28 %.
- **Neue Komponenten in `@up/ui`:**
  - `InfoTile`
  - `EditorialImageCard`, ganze Card ein Link, Bild als Slot, Mindesthöhe 128 px
  - `BottomNavigation`, aktiver Kreis an jeder Position, Safe Area
  - `PropertyName`
  - Komponenten mit Links nehmen eine `linkComponent` entgegen (Router-unabhängig).
- **Tablet:** dieselbe Komposition wie auf dem Smartphone, in einer zentrierten Spalte von max. 640 px.
- **Desktop:** Begrüßung neben den Tiles, drei Foto-Cards in 4 : 3, max. 1040 px.

## 13. Ergänzungen in Phase 3 (GUIDE)

- **Header-System:**
  - `BrandHeader` auf Bereichs-Startseiten (STAY, GUIDE): Wordmark, Property, Glocke. Auf STAY ist er pixelgleich zu Phase 2.
  - `BackHeader` auf Detailseiten: „← Guide“ mit 44 px Trefferfläche, Glocke. Die Property wird hier nicht wiederholt.
- **Seitenkopf:** dieselbe Abfolge wie auf STAY: Eyebrow, Display-Überschrift, Lead in `text-muted`, Abstand 24 px unter dem Header.
- **`LinkList`** (`@up/ui`):
  - Themenliste mit Outline-Icon (24 px), Titel (`type-title`), Beschreibung (`type-caption`) und Chevron
  - Haarlinien statt Cards, Zeilenhöhe mindestens 64 px, Hover als ruhige Linen-Fläche
- **`Callout`** (`@up/ui`): Hinweisfläche „Gut zu wissen“ auf `surface` mit Glühbirne und Eyebrow-Titel.
- **Detailseiten:**
  - Lesebreite max. 640 px, Titelbild 3 : 2 (`aspect-hero`) mit `radius-card`
  - Blöcke im ruhigen Rhythmus: Zwischenüberschrift 32 px Abstand, Absatz 8 px, Liste zwischen Haarlinien, Hinweis 32 px
- **Neue Icons:** car, plug, thermometer, trash, book-open, log-out, key, phone, mail.

## 14. Ergänzungen in Phase 5 (EXPLORE)

- **Übersicht:**
  - BrandHeader, Eyebrow „Explore“, Display-Titel und Lead aus dem Property-Content (z. B. „Allgäu entdecken“)
  - darunter der Kategorie-Filter und die Empfehlungen als `EditorialImageCard`: hervorgehobener Ort im Format 11 : 5, alle weiteren 11 : 4, Desktop dreispaltig 4 : 3
- **`FilterBar`** (`@up/ui`):
  - ruhige Versal-Labels (`type-eyebrow`), das aktive Label in `text` mit 1-px-Unterstreichung, inaktive in `text-muted`
  - keine Chips, keine Farben, Trefferfläche 44 px
  - auf schmalen Screens horizontal scrollbar, ohne Scrollbalken (`scrollbar-hidden`)
- **`DetailList`** (`@up/ui`): Info-Zeilen mit Outline-Icon (24 px), Label als Eyebrow und Wert in `type-body`/`text-muted`. Zeilenumbrüche bleiben erhalten (Adresse).
- **Detailseite:**
  - Zurück zu Explore, Kategorie als Eyebrow, Titel, Titelbild 3 : 2
  - persönliche Empfehlung als Lead in `text`, Beschreibung, „Gut zu wissen“ (`Callout`)
  - Infos hinter einer Haarlinie, darunter die Aktionen: die erste gefüllt, weitere als Outline, ab 360 px zweispaltig. Externe Links sind für Screenreader gekennzeichnet.
- **Navigation:** Labels mit mehr als 5 Zeichen (z. B. „EXPLORE“) nutzen im aktiven Kreis `type-nav-compact` (10 px, +0,02 em), damit sie den Kreisrand nicht berühren. STAY und GUIDE bleiben unverändert. C7 ist damit gelöst.
- **Bugfix `EditorialImageCard`:**
  - Die Mindesthöhe (128 px) wurde über das Seitenverhältnis zu einer Mindestbreite von 352 px. Das erzeugte horizontalen Überlauf unter 372 px und machte die Karten bei 390 px 2 px zu breit.
  - Jetzt ein Grid-Stapel: Ein Platzhalter trägt das Seitenverhältnis, die Textebene die Mindesthöhe. Bei 390 px sind die Karten wieder exakt 350 px breit, mit 20 px Seitenrand.
- **Neue Icons:** globe, navigation.

## 15. Ergänzungen in Phase 7 (Gastzugang)

- **`TextField`** (`@up/ui`): sichtbares Label im Eyebrow-Stil, Feld mit Rahmen in `text-muted` (≥ 3 : 1 Nicht-Text-Kontrast), Höhe 48 px, globaler Fokusring, optionaler Hinweis per `aria-describedby`. Dokumentiert im Design Lab, Abschnitt 13.
- **Neue Seiten ohne Bottom-Navigation:** `/login` und `/link-invalid`. Sie bestehen aus Wortmarke, H1, Lead, Formular bzw. einer sekundären Aktion. Fehlermeldungen erscheinen ruhig auf der Leinen-Fläche (`bg-surface`) in einer `role="status"`-Region, ohne Warnfarben.
- STAY, GUIDE und EXPLORE sind unverändert: Ein Pixelvergleich vorher/nachher bei 390 und 1440 px ergibt Diff 0.

## 16. Ergänzungen in Phase 9 (Admin App, GUIDE aus der DB)

- **Admin App** (`apps/admin`) nutzt dieselben Tokens, Fonts und Komponenten aus `@up/ui` (`Button`, `TextField`-Stil, Icons). Keine eigenen Farben, keine Hex-Werte und keine arbiträren Tailwind-Werte; der Token-Guard (`pnpm lint:tokens`) gilt auch für `apps/admin`.
- **Flächen:** Seitenhintergrund Off-White, Hover und Hervorhebungen auf `surface` (Leinen), Aktionen in Salbei (`action`), Text in Ink. Trennungen über Haarlinien statt Schatten.
- **Layout:** Desktop mit fester Seitennavigation (16 rem) und Inhaltsbereich, mobil gestapelt. Dichte und Typo bewusst ruhiger und kompakter als in der Guest App (`type-body`, `type-caption`, Eyebrows für Feldlabels).
- **Status** als ruhige Badges mit Punkt: Veröffentlicht auf `surface-accent` (Salbei), Entwurf und Archiviert auf `surface` in `text-muted`, ohne Warnfarben. Meldungen in `role="status"`-Regionen auf `surface`.
- **Guest App:** GUIDE ohne veröffentlichte Inhalte zeigt einen leeren Zustand mit kurzem Lead. Mit denselben Inhalten aus der Datenbank sind STAY, GUIDE und EXPLORE pixelgleich zu Phase 8 (Diff 0 bei 390 und 1440 px, DE/EN).

## 17. Korrektur nach Phase 9.1: primäre Buttons

- **Regel:** Primäre Call-to-Action-Buttons sind dunkel (`cta` = `#17160F`) mit weißem Text (`on-cta`). Salbei ist keine Button-Farbe mehr; `action` (primary-dark) bleibt für Links und kleine Akzenttexte.
- Umgesetzt zentral in `@up/ui`: `Button` (Variante `primary`, auch über `buttonStyles("primary")`) und `IconButton` (Variante `action`). Hover hellt um 16 % Richtung Weiß auf, Disabled nutzt weiter 40 % Deckkraft, der Fokusrahmen bleibt `focus`.
- Login: Die Subline hat keine künstliche Breitenbegrenzung mehr. Ab Tablet steht sie in einer Zeile (DE und EN), auf schmalen Screens bricht sie ausgeglichen um (`text-balance`).
- Pixelvergleich vorher/nachher (390 und 1440 px): STAY, GUIDE, EXPLORE-Übersicht und Link-ungültig unverändert (Diff 0). Geändert sind nur Login (DE/EN) und der Primär-Button der EXPLORE-Detailseite.

## 18. Admin-Shell (Phase 9.2)

- **Aufbau:** Sidebar auf `surface` (Leinen) ohne Trennlinie zur Arbeitsfläche auf `background`. Aktiver Menüpunkt als helle Fläche (`surface-raised`) in `text`, inaktive in `text-muted`. Gruppenüberschriften als Eyebrow. Icons nur in der Navigation (20 px, Outline).
- **Globaler Kontext:** Property Selector oben links in der Arbeitsfläche: Eyebrow „Objekt“, Name in der Markenschrift (`type-title`, Λ über `PropertyName`), dezentes Chevron. Die Auswahl öffnet eine helle Liste (`surface-raised`, `shadow-float`) mit Ort als Caption und Haken beim aktiven Eintrag.
- **Seitenkopf:** Pfad (nur übergeordnete Seiten, ohne das Objekt zu wiederholen), Titel `title-lg`, kurze Beschreibung, Aktionen rechts. Abschnitte mit `SectionHeader`, leere Zustände ruhig auf `surface`.
- **Objektlisten:** Haarlinien statt Cards: Name in der Markenschrift, Ort in `text-muted`, Ziel und Chevron rechts.
- **Responsive:** Ab 1024 px feste Sidebar, darunter Kopfzeile mit Menü-Button und Drawer (natives `dialog`: Fokusfalle, Escape, Backdrop).
- Sekundärtext bleibt beim Token `text-muted` (`#6B6A65`, statt `#74736E` für WCAG AA). Dunkle Primäraktionen nutzen `cta` (`#17160F`), Fließtext weiter `text` (`#171817`).

## 19. Offene Punkte (C)

| Nr. | Thema                                                     | Befund                                                                                                                                                                                                                          | Vorschlag                                                                                                                                                            |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Weiß auf Salbei** (Apartment-Tile)                      | ✅ **Phase 2 entschieden:** Text auf Salbei nutzt den Token `on-accent` = Ink (5,7 : 1, AA). Weiß (3,0 : 1) ist mit einer Zeile in `tokens.css` wiederherstellbar, dann aber nur AA für große Schrift.                          | –                                                                                                                                                                    |
| C2  | **Logo „UP“**                                             | Monogramm im Header ist ein eigenes Wortbild. Phase 2: Text-Wordmark „UNIQUE PLACES“ (`type-wordmark`) als Platzhalter.                                                                                                         | Logo als SVG bereitstellen; ersetzt die Wordmark in `StayHeader` (auch Favicon und App-Icon).                                                                        |
| C3  | **Josefin-Versalien sind breiter als die Mockup-Schrift** | Das Mockup ist offensichtlich nicht in Josefin Sans gesetzt. Labels und Navigation lassen sich nicht gleichzeitig in Breite _und_ Höhe treffen: Bei Breitengleichheit wären sie nur 8–9 px groß.                                | Versalhöhe priorisiert (11 px). Labels wirken dadurch etwas weiter gesperrt als im Mockup. Alternativ Labels in Roboto, was aber vom Markenschrift-Prinzip abweicht. |
| C4  | **Sekundärtext-Größe**                                    | Breitenmessung ergibt ca. 12,5–13 px, Versalhöhe ca. 13,6 px.                                                                                                                                                                   | 14 px gewählt (Lesbarkeit). Card-Sublines in der Referenz eher 13 px.                                                                                                |
| C5  | **Cards breiter als Textspalte**                          | Foto-Cards ragen ca. 2–3 pt über die Textkante hinaus (18 vs. 21 pt Rand).                                                                                                                                                      | Bewusst einheitliche 20-px-Kante. Bei Wunsch Cards um 2 px verbreitern.                                                                                              |
| C6  | **Griechisches Λ in „ΛLPILΛ“**                            | ✅ **Phase 2 gelöst:** `PropertyName` zeichnet das Λ aus Josefins eigenem „V“, vertikal gespiegelt (`glyph-flip-y`, Achse 0,36 em über der Grundlinie). Screenreader erhalten den `spokenName`.                                 | –                                                                                                                                                                    |
| C7  | **Navigation: wandernder Kreis**                          | ✅ **Phase 2:** Der Kreis gehört zum aktiven Punkt und wandert mit (GUIDE · STAY · EXPLORE). Offen: „EXPLORE“ füllt den 64-px-Kreis bis an den Rand; Desktop nutzt vorerst dieselbe Bottom Navigation (zentriert, max. 416 px). | Mit Umsetzung von EXPLORE die Label-Laufweite im aktiven Kreis prüfen; Top-Navigation für Desktop später entscheiden.                                                |
| C8  | **Gewicht der Subline**                                   | ✅ **Phase 2:** Roboto 400 statt 300 (Lesbarkeit auf dem Smartphone).                                                                                                                                                           | –                                                                                                                                                                    |
| C9  | **Platzhalterfotos**                                      | Phase 2: Ausschnitte aus dem Referenz-Mockup, mit Lanczos ×3 hochskaliert (`src/mocks/stay/images`). Externe Bildquellen sind aus der Entwicklungsumgebung nicht erreichbar.                                                    | Echte Fotografie je Property (Quer- und Hochformat, mind. 2000 px breit). Austausch nur in den Mock-/später DB-Daten, keine Komponentenänderung.                     |
| C10 | **Favicon / Theme Color**                                 | Noch nicht vorhanden (404 auf `/favicon.ico`).                                                                                                                                                                                  | Kommt mit dem Logo (C2).                                                                                                                                             |
