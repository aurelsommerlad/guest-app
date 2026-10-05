# 0004 – Gastzugang per Token-Link

**Status:** Akzeptiert (2026-10-05). Umsetzung in Phase 5.

## Kontext

Gäste sollen ohne Registrierung sofort Zugriff auf ihren Aufenthalt haben. Später kommen sensible Daten hinzu (Check-in, Ausweise, Zahlungen).

## Entscheidung

- Pro Reservation ein zufälliges Token (≥ 128 Bit). In der Datenbank liegt **nur der SHA-256-Hash**.
- Einstieg über `/s/{token}`:
  1. serverseitige Prüfung
  2. signiertes Session-Cookie (`httpOnly`, `Secure`, `SameSite=Lax`)
  3. Redirect auf eine Seite **ohne Token in der URL**
- **Ablauf:** Abreise + 3 Tage, als Einstellung `guestAccess.expiresAfterDepartureDays` (Default 3) auf Tenant- bzw. Property-Ebene, damit der Wert später konfigurierbar ist.
- Widerrufbar (`revoked_at`), Rate-Limiting am Einstieg, `Referrer-Policy: strict-origin-when-cross-origin`.
- Zugriffsstufen:
  - `public`: QR-Code, keine Personendaten
  - `reservation`: per Link
  - später `verified`: Step-up für sensible Module

## Konsequenzen

- Weitergeleitete Links geben Zugriff auf Stufe `reservation`. Das ist für v0.1 akzeptiert. Sensible Module erfordern Step-up.
