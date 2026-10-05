# 0005 – Zeitabhängige Sichtbarkeit

**Status:** Akzeptiert (2026-10-05). Umsetzung mit GUIDE (Phase 6).

## Kontext

Manche Inhalte sollen nur in bestimmten Zeitfenstern sichtbar sein, z. B. Anreiseinfos vor dem Aufenthalt oder später Nuki-Türcodes nur von Check-in bis Check-out. Wir wollen keine Rules Engine.

## Entscheidung

Ein einfaches Value Object `Visibility` in `@up/core`:

```ts
type VisibilityBoundary =
  | { type: "absolute"; at: string }
  | { type: "stay"; anchor: "arrival" | "departure"; offsetMinutes?: number; time?: "HH:mm" };

interface Visibility {
  audience?: "public" | "reservation"; // später "verified"
  from?: VisibilityBoundary; // visible_from
  until?: VisibilityBoundary; // visible_until
}
```

- Gespeichert als `visibility jsonb NULL` am jeweiligen Content-Element. `NULL` bedeutet immer sichtbar (gemäß Zugriffsstufe).
- Auswertung durch die reine Funktion `isVisible(visibility, { now, stay?, accessLevel })`. Stay-relative Grenzen werden in der Zeitzone der Property berechnet.
- Ohne Aufenthaltskontext sind stay-relative Grenzen nie erfüllt (sicherer Default).

## Konsequenzen

- Deckt `visible_from`/`visible_until` absolut und relativ zum Aufenthalt ab und ist vollständig unit-testbar.
- Erweiterungen (z. B. Wochentage) sind additive Felder. Komplexe Bedingungen (UND/ODER-Bäume) sind bewusst nicht vorgesehen.
