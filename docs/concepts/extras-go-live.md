# Gemeinsamer Go-live STAY ↔ Extras: technisches Konzept (M1-E)

Stand: 08.11.2026. **Vorbereitet, nicht aktiviert.** Nichts hier ändert heute etwas an Extras, Apaleo oder der STAY-Produktion.

## Ziel

Ein einziger, kontrollierter Wechsel des produktiven Apaleo-Schreibers von Extras zu STAY, für alle Objekte gleichzeitig. Bis dahin bleibt Extras unverändert produktiv. Danach steht Extras als Rückfall bereit, bis die Stilllegung freigegeben ist.

## Bausteine (in M1 umgesetzt)

| Baustein                        | Ort                                                                                          | Wirkung                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schreiberwert + Go-live-Zustand | `tenant_service_settings` (Migration 0018)                                                   | `service_writer` = `extras` (Standard) oder `stay`; `go_live_state` = `extras_active` → `syncing` → `extras_locked` → `stay_active`. CHECK: `stay` genau dann, wenn `stay_active`.                                                                 |
| Schutz gegen Fehlbedienung      | Trigger `tenant_service_settings_guard_writer`                                               | Jede Änderung von Schreiber oder Zustand wird abgewiesen, außer in einer Transaktion, die `up.writer_switch = 'on'` setzt. Das tut nur die Go-live-Prozedur. Admin-Formulare, Import und versehentliches SQL können den Schreiber nicht umstellen. |
| Go-live-Prozedur                | `transitionGoLiveState()` in `packages/db/src/repositories/service-operations-repository.ts` | Erlaubte Übergänge (siehe unten), Prüfliste vor `stay_active` ist Pflicht, jeder Schritt im Audit-Log. **An keine Oberfläche und kein CLI angeschlossen.**                                                                                         |
| Recht                           | `writer.switch` in `packages/core/src/admin/permissions.ts`                                  | nur Owner mit Zugriff auf alle Objekte                                                                                                                                                                                                             |
| Schreib-Gateway                 | `packages/integrations/src/apaleo/services/write-gateway.ts`                                 | prüft vor jedem Schreiben den Schreiberwert; ein echter Executor wird abgewiesen, solange `extras` Schreiber ist. In M1 gibt es keinen echten Executor (`disabled`/`simulated`).                                                                   |
| Delta-Export/-Import + Abgleich | `extras:export`, `extras:import`, `reconcileExtras()`                                        | wiederholbar, idempotent, Konflikte statt Überschreiben, Prüfsummen                                                                                                                                                                                |

## Zustände und Übergänge

```
extras_active ──► syncing ──► extras_locked ──► stay_active
      ▲              │              │                 │
      └──────────────┘              │                 │
      ▲      (Abbruch Sync)         │                 │
      └─────────────────────────────┘                 │
             (Abbruch vor Aktivierung)                │
                    extras_locked ◄───────────────────┘
                                      (Rückfall)
```

| Zustand         | Extras                                                | STAY                                               |
| --------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `extras_active` | produktiv, schreibt                                   | liest/zeigt; Gateway blockiert                     |
| `syncing`       | produktiv, schreibt                                   | Delta-Import läuft wiederholt; Gateway blockiert   |
| `extras_locked` | **keine neuen Buchungen/Anfragen** (Sperre in Extras) | letzter Delta-Import, Prüfungen; Gateway blockiert |
| `stay_active`   | gesperrt, nur Rückfall                                | produktiver Schreiber                              |

## Ablauf am Go-live-Tag

Voraussetzungen (eigene Freigaben): STAY-Production-Datenbank eingerichtet und migriert, M2–M5 abgenommen, Live-Executor für Produktion freigegeben, Extras-Sperre (kleine Änderung in guest-services) freigegeben und ausgerollt, aber nicht aktiv.

1. **Extras bleibt produktiv** bis unmittelbar vor dem Wechsel (`extras_active`).
2. **Synchronisation** (`syncing`): Delta-Export (lesend) und Import auf die STAY-Production-Datenbank, wiederholt bis der Abgleich keine Abweichung zeigt. Offene Anfragen, Katalog, Einstellungen, Bilder.
3. **Extras sperren** (`extras_locked`): Sperrwert in Extras setzen → Extras lehnt neue Bestellungen, Anfragen, Freigaben und Verlängerungen ab und zeigt Gästen einen Hinweis bzw. leitet auf STAY. Danach ein letzter Delta-Lauf (nur, was seit Schritt 2 hinzukam) und ein Abgleich.
4. **Prüfungen** (Pflicht, im Audit gespeichert), z. B.:
   - `sync`: Abgleich ohne Abweichung, keine offenen Konflikte;
   - `extras_locked`: Testbestellung in Extras wird abgewiesen;
   - `apaleo_read`: STAY liest Reservierungen und Service-Angebote aller Objekte;
   - `smoke`: simulierte Buchung je Objekt im Gateway erfolgreich;
   - `notifications`: Slack-Testnachricht im Zielkanal.
5. **STAY aktivieren** (`stay_active`, nur Owner): erst jetzt kann das Gateway schreiben. Beobachtung (Fehler, Doppelbuchungen = 0).
6. **Rückfall** jederzeit: `stay_active → extras_locked` (STAY schreibt sofort nicht mehr), offene STAY-Vorgänge entscheiden oder übergeben, dann `extras_locked → extras_active` und Extras-Sperre aufheben.

Zu keinem Zeitpunkt sind beide Systeme freigeschaltet: STAY wird erst aktiv, wenn Extras gesperrt ist; beim Rückfall wird STAY gesperrt, bevor Extras wieder öffnet.

## Was in Extras noch nötig ist (nicht umgesetzt – Freigabe für guest-services erforderlich)

- Ein Sperrwert (z. B. KV-Schlüssel `stay-go-live:lock`), den Extras vor jedem Schreibzugriff liest (Gast-Bestellung, Anfrage, Bestätigung, Verlängerung, Admin-Katalog). Gesetzt ist er nur in `extras_locked`/`stay_active`.
- Optional ein Hinweis-/Weiterleitungsziel für Gäste.

## Nichts geht verloren

- Export und Import sind wiederholbar, mit Prüfsummen und Protokoll; der letzte Delta-Lauf erfolgt nach der Sperre.
- Extras-Daten werden nie verändert oder gelöscht; sie sind Rückfall und Archiv.
- Abschluss-Export mit Prüfsummen vor der Stilllegung.
- Apaleo bleibt Quelle der Buchungen.

## Nicht aktiv

- Keine Oberfläche, kein CLI ruft `transitionGoLiveState()` auf.
- Kein Live-Executor im Gateway; Modus nur `disabled` (Standard) oder `simulated`.
- Die STAY-Production-Datenbank existiert nicht.
