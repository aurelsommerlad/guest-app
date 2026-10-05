# 0012 – Zentraler Guest/Stay Context

**Status:** Akzeptiert (2026-10-05, Phase 8). Baut auf [ADR 0011](0011-guest-access.md) auf.

## Kontext

STAY bezog seinen Aufenthalt seit Phase 7 aus der Guest Session. GUIDE und EXPLORE nutzten noch einen festen Mock-Kontext: `features/guest-context.ts` mit HØV · ROS, `MOCK_NOW` und den Daten der Mock-Reservierung. Damit gab es zwei Wahrheiten. Ein Gast in HØV · ESL hätte im GUIDE die Inhalte für ROS gesehen.

## Entscheidung

Es gibt **einen** serverseitigen Kontext pro Request. Alle Gastbereiche lesen nur ihn.

```
Cookie → resolveGuestSession() → CurrentGuestAccess
       → resolveGuestContext()  (features/guest-context/guest-context.ts, framework-frei)
           ├─ guest:   Reservierung live über pmsFor(reservation_provider) → toStaySource()
           └─ preview: nur GUEST_ACCESS_MODE=preview und nie in Production – Preview-Reservierung, gleicher Weg
       → getGuestContext()      (server.ts: React cache – einmal pro Request, für alle Bereiche)
       → requireGuestContext(locale): ohne Session → /login, unpassende Reservierung → /link-invalid
```

**`GuestContext`** enthält:

- `mode`, `tenantId`, `propertyId`, `unitId`, `reservationProvider`, `externalReservationId`, `guestAccessId`
- `property`: Anzeige-Identität aus der Registry
- `now`
- `reservation`: `loaded` mit `StaySource` oder `unavailable`

**Regeln:**

- **Unit:** Sie kommt live aus der Reservierung, weil Apaleo umbuchen kann. Ist das PMS nicht erreichbar, gilt die gespeicherte Unit des Guest Access.
- **PMS nicht erreichbar:**
  - Der Kontext bleibt mit Property und Unit erhalten (`reservation.status = "unavailable"`).
  - GUIDE und EXPLORE funktionieren weiter. Aufenthaltsabhängig sichtbare Inhalte bleiben dann verborgen, weil die Sichtbarkeit bei fehlenden Daten geschlossen ist.
  - STAY zeigt seine Fehlerseite.
- **Storniert oder unpassend:** Ist die Reservierung storniert oder passt sie nicht zu Tenant oder Property, liefert der Kontext `access-invalid`. Jeder Bereich leitet dann auf die neutrale Seite.
- **Kein stiller Mock:** Ohne Session gibt es den Preview-Kontext nur im Modus `preview` **außerhalb von Production**. Im Modus `secured` und in Production wird immer auf `/login` umgeleitet, auch wenn dort `preview` konfiguriert wäre.
- **GUIDE:** `guideContextOf(context)` liefert dieselbe Scope-Auswahl wie bisher: Tenant, plus Property, plus Unit des Gastes. Die Vererbung per `key` (spezifischster Scope gewinnt) ist weiterhin nur vorbereitet ([ADR 0007](0007-guide-content-model.md)).
- **Rendering:** GUIDE- und EXPLORE-Seiten werden pro Request gerendert, weil ihr Inhalt von Session, Property und Unit abhängt. Unbekannte Slugs bleiben 404. Die Darstellung ist unverändert, der Pixelvergleich ergibt Diff 0.
- **Navigation:** Das Session-Cookie gilt für `Path=/`. STAY, GUIDE und EXPLORE lösen bei jedem Request dieselbe Session auf; eine erneute Anmeldung ist nicht nötig.

## Konsequenzen

- Neue Bereiche (Extras, Check-in, Access, Chat) nutzen `requireGuestContext()` und erfinden keinen eigenen Kontext.
- Pro Request gibt es höchstens einen PMS-Abruf, auch wenn mehrere Bereiche ihn brauchen (React `cache`).
- Die Inhalte für weitere Properties fehlen noch (Mock-Content nur für HØV). Ein Gast in HŪSLE sähe einen leeren GUIDE. Die Daten gehören in die spätere Content-Phase.
