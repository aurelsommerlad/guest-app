import {
  TextField,
  baseColorTokens,
  BottomNavigation,
  Button,
  Callout,
  DetailList,
  buttonStyles,
  Container,
  Heading,
  Icon,
  IconButton,
  iconNames,
  InfoTile,
  LinkList,
  PropertyName,
  radiusTokens,
  semanticColorTokens,
  spacingScale,
  Stack,
  Surface,
  Text,
  typeStyles,
} from "@up/ui";
import type { Metadata } from "next";

import { serverEnv } from "../../../env/server";
import extras from "./_assets/placeholder-extras.webp";
import interior from "./_assets/placeholder-interior.webp";
import landscape from "./_assets/placeholder-landscape.webp";
import { ColorSwatches, SemanticColorList } from "./_components/ColorSwatches";
import { ContrastTable } from "./_components/ContrastTable";
import { ExploreFilterDemo } from "./_components/ExploreFilterDemo";
import { ImageCardSample } from "./_components/ImageCardSample";
import { LabSection } from "./_components/LabSection";
import { ScaledFrame } from "./_components/ScaledFrame";

export const metadata: Metadata = { title: "Design Lab · UNIQUE PLACES" };

const sections = [
  ["farben", "Farben"],
  ["typografie", "Typografie"],
  ["abstaende", "Abstände"],
  ["formen", "Formen"],
  ["buttons", "Buttons"],
  ["flaechen", "Flächen"],
  ["icons", "Icons"],
  ["bild", "Bild & Text"],
  ["breiten", "Breiten"],
  ["stay", "Stay-Bausteine"],
  ["guide", "Guide-Bausteine"],
  ["explore", "Explore-Bausteine"],
  ["forms", "Formularfelder"],
] as const;

const guideItems = [
  {
    id: "arrival",
    href: "#guide",
    title: "Ankunft & Parken",
    description: "Anreise, Parken und Self-Check-in",
    icon: "car",
  },
  { id: "wifi", href: "#guide", title: "WLAN", description: "Netzwerk und Passwort", icon: "wifi" },
  {
    id: "check-out",
    href: "#guide",
    title: "Check-out",
    description: "Abreise und letzte Schritte",
    icon: "log-out",
  },
] as const;

const navItems = [
  { id: "guide", href: "#stay", label: "Guide", icon: "map" },
  { id: "stay", href: "#stay", label: "Stay", icon: "bed" },
  { id: "explore", href: "#stay", label: "Explore", icon: "compass" },
] as const;

const properties = [
  { name: "HØV", spokenName: "Höv" },
  { name: "HŪSLE", spokenName: "Husle" },
  { name: "ΛLPILΛ", spokenName: "Alpila" },
  { name: "LÆKE", spokenName: "Laeke" },
] as const;

/** Sample copy per type style, taken from the PRIMARY DESIGN REFERENCE where possible. */
const typeSamples: Record<string, string> = {
  "type-display": "Hallo Laura, schön, dass Du da bist.",
  "type-title-lg": "Anreise & Parken",
  "type-title": "Alles für Deinen Aufenthalt",
  "type-figure": "10:00",
  "type-brand": "HØV · Altusried",
  "type-eyebrow": "Check-out",
  "type-nav": "Guide · Stay · Explore",
  "type-lead": "Wir wünschen Dir einen wunderbaren Aufenthalt.",
  "type-body":
    "Das WLAN steht Dir im gesamten Haus und in allen Apartments kostenfrei zur Verfügung. Bodenständig, regional und einfach gut.",
  "type-small": "31. August 2026",
  "type-caption": "Extras unterliegen der Verfügbarkeit und werden nach Buchung bestätigt.",
};

export default function DesignLabPage() {
  return (
    <main className="pb-24">
      {/* ── Intro ─────────────────────────────────────────── */}
      <Container width="wide" className="pt-5 lg:pt-10">
        <header className="flex min-h-11 items-center justify-between">
          <Text as="span" variant="brand">
            UNIQUE PLACES <span className="px-1 text-text-muted">·</span>{" "}
            <span className="text-text-muted">Design Lab</span>
          </Text>
          <Text as="span" variant="eyebrow" tone="muted">
            {serverEnv.APP_ENV}
          </Text>
        </header>

        <div className="grid gap-6 pt-10 pb-12 lg:grid-cols-12 lg:pt-20 lg:pb-20">
          <Stack gap={4} className="lg:col-span-7">
            <Text variant="eyebrow" tone="muted">
              Phase 1 · Designsystem
            </Text>
            <Heading level={1}>Das visuelle Fundament der Guest App.</Heading>
            <Text variant="lead" tone="muted" className="max-w-reading">
              Tokens, Typografie und erste Bausteine – abgeleitet aus der STAY-Referenz. Diese Seite
              ist intern und nur in local und staging erreichbar.
            </Text>
          </Stack>
        </div>

        <nav
          aria-label="Abschnitte"
          className="-mx-gutter overflow-x-auto px-gutter pb-6 md:mx-0 md:px-0"
        >
          <ul className="flex gap-2">
            {sections.map(([id, label], i) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="type-small flex min-h-11 items-center gap-2 rounded-full border border-border px-4 whitespace-nowrap transition-colors hover:bg-surface"
                >
                  <span className="type-caption text-text-muted tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      {/* ── 01 Farben ─────────────────────────────────────── */}
      <LabSection
        id="farben"
        index="01"
        title="Farben"
        intro="Warme, ruhige Naturtöne. Salbei ist die charakteristische Fläche, Primary Dark trägt Interaktion und kleine Akzente."
      >
        <Stack gap={12}>
          <ColorSwatches tokens={baseColorTokens} />
          <Stack gap={4}>
            <Heading level={3}>Semantische Rollen</Heading>
            <SemanticColorList tokens={semanticColorTokens} />
          </Stack>
          <Stack gap={4}>
            <Heading level={3}>Kontraste</Heading>
            <ContrastTable />
          </Stack>
        </Stack>
      </LabSection>

      {/* ── 02 Typografie ─────────────────────────────────── */}
      <LabSection
        id="typografie"
        index="02"
        title="Typografie"
        intro="Josefin Sans für Headlines, Labels und Kennzahlen – Roboto für Fließtext. Größen kalibriert an der Referenz bei 390 pt Breite."
      >
        <Stack gap={10}>
          <div className="grid grid-cols-2 gap-2">
            <Surface padding="lg">
              <Stack gap={4}>
                <span className="type-display text-text" aria-hidden>
                  Aa
                </span>
                <Text variant="small">Josefin Sans</Text>
                <Text variant="caption" tone="muted">
                  Headlines · Light 300 · Regular 400 · SemiBold 600
                </Text>
              </Stack>
            </Surface>
            <Surface padding="lg">
              <Stack gap={4}>
                <span className="type-display font-body text-text" aria-hidden>
                  Aa
                </span>
                <Text variant="small">Roboto</Text>
                <Text variant="caption" tone="muted">
                  Fließtext · Light 300 · Regular 400
                </Text>
              </Stack>
            </Surface>
          </div>

          <ul className="divide-y divide-border border-y border-border">
            {typeStyles.map((style) => (
              <li key={style.utility} className="grid gap-3 py-6 md:grid-cols-12 md:gap-6">
                <div className="md:col-span-4">
                  <Text variant="small">{style.name}</Text>
                  <Text variant="caption" tone="muted">
                    {style.family} · {style.spec}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {style.usage}
                  </Text>
                </div>
                <p className={`${style.utility} text-text md:col-span-8`}>
                  {typeSamples[style.utility]}
                </p>
              </li>
            ))}
          </ul>
        </Stack>
      </LabSection>

      {/* ── 03 Abstände ───────────────────────────────────── */}
      <LabSection
        id="abstaende"
        index="03"
        title="Abstände"
        intro="4-px-Raster. Großzügig nach außen, eng innerhalb von Gruppen: 8 px zwischen Geschwistern, 12 px zwischen Gruppen, 40 px und mehr zwischen Abschnitten."
      >
        <Stack gap={10}>
          <ul className="flex flex-col gap-3">
            {spacingScale.map((step) => (
              <li key={step} className="flex items-center gap-4">
                <Text
                  as="span"
                  variant="caption"
                  tone="muted"
                  className="w-16 shrink-0 tabular-nums"
                >
                  {step * 4} px
                </Text>
                <span
                  className="h-3 rounded-sm bg-surface-accent"
                  style={{ width: `${step * 4}px` }}
                />
              </li>
            ))}
          </ul>
          <div className="grid gap-2 md:grid-cols-3">
            {[
              ["Seitenrand", "20 px", "Tablet 32 px · Desktop 48 px"],
              ["In der Gruppe", "8 px", "Tiles, Foto-Cards untereinander"],
              ["Zwischen Gruppen", "12 px", "Tiles → Foto-Cards"],
              ["Card-Innenabstand", "16 px", "Tiles und Text auf Fotos"],
              ["Header → Begrüßung", "40 px", "Viel Luft für die Hauptaussage"],
              ["Touch-Ziel", "44 px", "Mindestgröße interaktiver Elemente"],
            ].map(([label, value, note]) => (
              <Surface key={label}>
                <Stack gap={2}>
                  <Text as="span" variant="eyebrow" tone="muted">
                    {label}
                  </Text>
                  <Text as="span" variant="figure">
                    {value}
                  </Text>
                  <Text as="span" variant="caption" tone="muted">
                    {note}
                  </Text>
                </Stack>
              </Surface>
            ))}
          </div>
        </Stack>
      </LabSection>

      {/* ── 04 Formen ─────────────────────────────────────── */}
      <LabSection
        id="formen"
        index="04"
        title="Radien, Schatten & Bewegung"
        intro="Sanfte, kleine Radien. Flächen trennen sich durch Ton statt Schatten. Bewegung ist ruhig und entfällt bei reduzierter Bewegung."
      >
        <Stack gap={10}>
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {radiusTokens.map((radius) => (
              <li key={radius.variable}>
                <Stack gap={3}>
                  <div className={`aspect-square bg-surface-accent ${radius.utility}`} />
                  <Text variant="small">{radius.utility.replace("rounded-", "")}</Text>
                  <Text variant="caption" tone="muted">
                    {radius.usage}
                  </Text>
                </Stack>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <Surface className="min-h-28">
              <Text variant="small">Flach (Standard)</Text>
              <Text variant="caption" tone="muted">
                Tiles, Cards, Bilder
              </Text>
            </Surface>
            <Surface tone="raised" className="min-h-28 shadow-float">
              <Text variant="small">Float</Text>
              <Text variant="caption" tone="muted">
                Nur für schwebende Elemente (später: Sheets, Toasts)
              </Text>
            </Surface>
          </div>
          <Text variant="caption" tone="muted">
            Bewegung: 150 ms (Hover) · 250 ms (Standard) · 400 ms (Übergänge) · Easing
            cubic-bezier(0.22, 1, 0.36, 1). Bei „Bewegung reduzieren“ werden Animationen systemweit
            deaktiviert.
          </Text>
        </Stack>
      </LabSection>

      {/* ── 05 Buttons ────────────────────────────────────── */}
      <LabSection
        id="buttons"
        index="05"
        title="Buttons"
        intro="Wenige, ruhige Varianten. Mit der Tab-Taste wird der Fokusrahmen sichtbar."
      >
        <Stack gap={8}>
          <Stack direction="horizontal" gap={3} wrap align="center">
            <Button>Route planen</Button>
            <Button variant="secondary">Website öffnen</Button>
            <Button variant="link" iconEnd="arrow-right">
              Details ansehen
            </Button>
            <Button disabled>Nicht verfügbar</Button>
          </Stack>
          <Surface tone="accent" padding="lg">
            <Stack gap={4}>
              <Text variant="small" tone="inherit">
                Auf der Salbei-Fläche erbt der Link-Button die Textfarbe.
              </Text>
              <div>
                <a href="#buttons" className={buttonStyles("link")}>
                  Details ansehen <Icon name="arrow-right" size="sm" />
                </a>
              </div>
            </Stack>
          </Surface>
          <Stack direction="horizontal" gap={4} wrap align="center">
            <div className="rounded-card bg-surface-accent p-4">
              <IconButton icon="arrow-right" label="Weiter" />
            </div>
            <IconButton icon="plus" label="Hinzufügen" variant="action" size="sm" />
            <IconButton icon="bell" label="Benachrichtigungen" variant="ghost" />
            <IconButton icon="arrow-left" label="Zurück" variant="ghost" />
            <IconButton icon="copy" label="Passwort kopieren" variant="ghost" />
          </Stack>
        </Stack>
      </LabSection>

      {/* ── 06 Flächen ────────────────────────────────────── */}
      <LabSection
        id="flaechen"
        index="06"
        title="Flächen"
        intro="Die Grund-Surface in ihren Tönen. Die Beispiele sind aus Primitives komponiert – die finalen Tiles folgen später."
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {(
            [
              ["card", "Card", "Standard"],
              ["accent", "Accent", "Salbei"],
              ["raised", "Raised", "Listen"],
              ["inverse", "Inverse", "Akzent"],
              ["outline", "Outline", "Neutral"],
            ] as const
          ).map(([tone, label, note]) => (
            <Surface
              key={tone}
              tone={tone}
              className="flex min-h-28 flex-col justify-between gap-4"
            >
              <Text as="span" variant="eyebrow" tone="inherit">
                {label}
              </Text>
              <Stack gap={1}>
                <Text as="span" variant="figure" tone="inherit">
                  {note}
                </Text>
                <Text as="span" variant="caption" tone="inherit">
                  surface · {tone}
                </Text>
              </Stack>
            </Surface>
          ))}
        </div>
      </LabSection>

      {/* ── 07 Icons ──────────────────────────────────────── */}
      <LabSection
        id="icons"
        index="07"
        title="Icons"
        intro="Feine Outline-Icons (1,5 px Strich, runde Enden) in drei Größen: 16, 20 und 24 px."
      >
        <Stack gap={8}>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {iconNames.map((name) => (
              <li key={name}>
                <Surface className="flex aspect-square flex-col items-center justify-center gap-3">
                  <Icon name={name} size="lg" />
                  <Text as="span" variant="caption" tone="muted">
                    {name}
                  </Text>
                </Surface>
              </li>
            ))}
          </ul>
          <Stack direction="horizontal" gap={8} align="end">
            {(["sm", "md", "lg"] as const).map((size) => (
              <Stack key={size} gap={2} align="center">
                <Icon name="compass" size={size} />
                <Text as="span" variant="caption" tone="muted">
                  {size}
                </Text>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </LabSection>

      {/* ── 08 Bild & Text ────────────────────────────────── */}
      <LabSection
        id="bild"
        index="08"
        title="Bild & Text"
        intro="Große Fotografie, Text unten links auf einem sanften Verlauf, runder Pfeil-Button. Die Bilder sind Platzhalter aus dem Referenz-Mockup."
      >
        <Stack gap={2}>
          <div className="grid gap-2 lg:grid-cols-3">
            <ImageCardSample
              image={interior}
              ratio="feature"
              title="Alles für Deinen Aufenthalt"
              subtitle="WLAN, Geräte, Haus & Apartment"
              sizes="(min-width: 1024px) 22vw, 100vw"
            />
            <ImageCardSample
              image={extras}
              title="Extras"
              subtitle="Mach Deinen Aufenthalt noch schöner"
              sizes="(min-width: 1024px) 22vw, 100vw"
            />
            <ImageCardSample
              image={landscape}
              title="Allgäu entdecken"
              subtitle="Unsere Lieblingsplätze für Dich"
              sizes="(min-width: 1024px) 22vw, 100vw"
            />
          </div>
          <Text variant="caption" tone="muted">
            Seitenverhältnisse mobil: 11 : 5 (erste Card) und 11 : 4 (folgende Cards). Ab Desktop
            einheitlich 4 : 3.
          </Text>
        </Stack>
      </LabSection>

      {/* ── 09 Breiten ────────────────────────────────────── */}
      <LabSection
        id="breiten"
        index="09"
        title="Breiten"
        intro="Dieselbe Komposition bei echter Smartphone-, Tablet- und Desktop-Breite. Desktop ist ein eigenes, editoriales Layout – keine gestreckte Mobile-Ansicht."
      >
        <Stack gap={10}>
          <div className="grid items-start gap-8 md:grid-cols-2">
            <Stack gap={3}>
              <Text variant="eyebrow" tone="muted">
                Smartphone · 390 px
              </Text>
              <ScaledFrame
                src="/dev/ui/frame"
                width={390}
                height={844}
                title="Komposition bei 390 px Breite"
              />
            </Stack>
            <Stack gap={3}>
              <Text variant="eyebrow" tone="muted">
                Tablet · 820 px
              </Text>
              <ScaledFrame
                src="/dev/ui/frame"
                width={820}
                height={1180}
                title="Komposition bei 820 px Breite"
              />
            </Stack>
          </div>
          <Stack gap={3}>
            <Text variant="eyebrow" tone="muted">
              Desktop · 1440 px
            </Text>
            <ScaledFrame
              src="/dev/ui/frame"
              width={1440}
              height={900}
              title="Komposition bei 1440 px Breite"
            />
          </Stack>
          <Text variant="caption" tone="muted">
            Kompositionsprobe aus Primitives zur Prüfung von Rhythmus und Proportionen – nicht die
            STAY-Seite.
          </Text>
        </Stack>
      </LabSection>

      {/* ── 10 Stay-Bausteine ─────────────────────────────── */}
      <LabSection
        id="stay"
        index="10"
        title="Stay-Bausteine"
        intro="Die Komponenten des STAY-Startscreens in ihren Zuständen. Der echte Screen liegt unter /de/stay."
      >
        <Stack gap={12}>
          <Stack gap={4}>
            <Heading level={3}>Info-Tiles: während und vor dem Aufenthalt</Heading>
            <dl className="grid max-w-96 grid-cols-2 gap-2">
              <InfoTile icon="calendar" label="Check-out" value="10:00" meta="31. August 2026" />
              <InfoTile
                icon="home"
                label="Apartment"
                value="ROS"
                tone="accent"
                meta="Details ansehen →"
              />
            </dl>
            <dl className="grid max-w-96 grid-cols-2 gap-2">
              <InfoTile
                icon="check"
                label="Online-Check-in"
                value="Jetzt erledigen"
                valueStyle="text"
                meta="Noch 2 Schritte →"
              />
              <InfoTile
                icon="home"
                label="Apartment"
                value="ROS"
                tone="accent"
                meta="Details ansehen →"
              />
            </dl>
          </Stack>

          <Stack gap={4}>
            <Heading level={3}>Property-Namen</Heading>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {properties.map((property) => (
                <li key={property.name}>
                  <Surface className="flex min-h-28 flex-col justify-between gap-4">
                    <span className="type-display">
                      <PropertyName name={property.name} spokenName={property.spokenName} />
                    </span>
                    <span className="type-brand">
                      <PropertyName name={property.name} spokenName={property.spokenName} />
                      <span className="px-1.5 text-text-muted">·</span>
                      <span className="text-text-muted">{property.spokenName}</span>
                    </span>
                  </Surface>
                </li>
              ))}
            </ul>
            <Text variant="caption" tone="muted">
              Ø, Ū und Æ kommen direkt aus Josefin Sans. Das Λ wird aus Josefins eigenem „V“
              gespiegelt, weil die Schrift keine griechischen Zeichen enthält. Screenreader hören
              den aussprechbaren Namen.
            </Text>
          </Stack>

          <Stack gap={4}>
            <Heading level={3}>Navigation: der Kreis wandert mit</Heading>
            <div className="grid gap-2 md:grid-cols-3">
              {navItems.map((item) => (
                <div key={item.id} className="overflow-hidden rounded-card border border-border">
                  <BottomNavigation
                    items={navItems}
                    activeId={item.id}
                    label={`Beispiel: ${item.label} aktiv`}
                  />
                </div>
              ))}
            </div>
          </Stack>
        </Stack>
      </LabSection>

      {/* ── 11 Guide-Bausteine ────────────────────────────── */}
      <LabSection
        id="guide"
        index="11"
        title="Guide-Bausteine"
        intro="Ruhige Themenliste mit Haarlinien statt Cards und die Hinweisfläche „Gut zu wissen“. Der echte Bereich liegt unter /de/guide."
      >
        <Stack gap={10}>
          <div className="max-w-reading">
            <LinkList items={guideItems} headingLevel={3} />
          </div>
          <div className="max-w-reading">
            <Callout title="Gut zu wissen">
              Die Beschilderung vor Ort führt Dich zu Parkplatz und Eingang.
            </Callout>
          </div>
        </Stack>
      </LabSection>

      {/* ── 12 Explore-Bausteine ──────────────────────────── */}
      <LabSection
        id="explore"
        index="12"
        title="Explore-Bausteine"
        intro="Ruhiger Text-Filter statt Chips und Info-Zeilen für praktische Details. Der echte Bereich liegt unter /de/explore."
      >
        <Stack gap={10}>
          <div className="max-w-reading">
            <ExploreFilterDemo />
          </div>
          <div className="max-w-reading">
            <DetailList
              items={[
                {
                  id: "hours",
                  icon: "clock",
                  label: "Öffnungszeiten",
                  value: "Mittwoch bis Sonntag ab 17:00 Uhr",
                },
                {
                  id: "address",
                  icon: "map-pin",
                  label: "Adresse",
                  value: "Beispielweg 1\n00000 Musterort",
                },
              ]}
            />
          </div>
        </Stack>
      </LabSection>

      {/* ── 13 Formularfelder ─────────────────────────────── */}
      <LabSection
        id="forms"
        index="13"
        title="Formularfelder"
        intro="TextField: sichtbares Label (Eyebrow), Rahmen in text-muted für ≥ 3 : 1 Kontrast, globaler Fokusring, optionaler Hinweis per aria-describedby. Eingesetzt im Gastzugang unter /de/login."
      >
        <div className="flex max-w-reading flex-col gap-6">
          <TextField
            id="lab-booking"
            label="Buchungsnummer"
            hint="Du findest Deine Buchungsnummer in Deiner Buchungsbestätigung."
            autoComplete="off"
          />
          <TextField id="lab-name" label="Nachname" defaultValue="Muster" autoComplete="off" />
        </div>
      </LabSection>
    </main>
  );
}
