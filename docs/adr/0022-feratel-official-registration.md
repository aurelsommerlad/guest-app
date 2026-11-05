# 0022 – Direkte Feratel-Anbindung: elektronische Gästemeldung und digitale Gästekarten

**Status:** Akzeptiert für die Umsetzung in Phasen (2026-11-05). **F0 und F1 sind umgesetzt.** F1 läuft nur mit simulierten Antworten. F2 und alle weiteren Phasen brauchen eine eigene Freigabe.

Ergänzt [ADR 0016](0016-guest-journey-and-online-check-in.md) (Registrierungs-Sync) und [ADR 0021](0021-check-in-validation-and-billing-address.md) (Bestätigungen, Meldevorlagen). Recherche und Fragen: [docs/integrations/feratel-guest-registration.md](../integrations/feratel-guest-registration.md) und [Anfrage an feratel](../integrations/feratel-anfrage-visitor-registration-interface.md).

## Kontext

Die Meldedaten aus dem Online-Check-in sollen automatisch an das feratel-Meldewesen gehen. Die Gäste sollen ihre digitalen Gästekarten automatisch erhalten. Betroffen sind:

| Objekt | Standort           | Meldewesen                     |
| ------ | ------------------ | ------------------------------ |
| ΛLPILΛ | Gaschurn, Montafon | feratel                        |
| HŪSLE  | Bludenz            | feratel                        |
| LÆKE   | Lindau             | System offen: feratel oder AVS |

HØV braucht keine Übertragung.

Öffentlich belegt ist:

- Es gibt ein „Visitor Registration Interface“ (Deskline 3.0) für Hotelprogramme.
- Die Gemeinden vergeben „Mapping Codes“, und Hotelprogramme werden von feratel abgenommen.
- In Vorarlberg gilt:
  - Eine **Voranmeldung** ist änderbar und löschbar.
  - Ein **Meldeschein** ist verbindlich und nicht mehr änderbar.
  - Alle Gäste einer Meldung haben dieselben Reisedaten.
  - Liegt eine Gast-E-Mail vor, versendet das System den Link zur digitalen Gästekarte automatisch.

**Nicht** öffentlich belegt sind Endpunkte, Nachrichtenformate, Authentifizierung, Testumgebung und Rückgabewerte. Die Dokumentation unter `interfaces.deskline.net` ist aus der Cloud-Umgebung nicht erreichbar.

## Entscheidung

1. **Eigene, direkte Anbindung.** Es gibt keinen Drittanbieter. Apaleo hat nach unserer Recherche keine Feratel-Anbindung.
2. **Neues, providerneutrales Meldemodell** in `@up/core` (`official-registration/`). Der bestehende Registrierungs-Sync (ADR 0016) und `FeratelRegistrationProvider` bleiben **unverändert und inaktiv**.
3. **Zwei getrennte Spuren je Reservierung und Ziel:**
   - **Meldung:**
     - Stufe beim Ziel: `none`, `pre-registered`, `registered`, `checked-out`, `cancelled`.
     - Status für das Team: `pending` (ausstehend), `transmitted` (übertragen), `confirmed` (bestätigt, mit Referenz des Ziels), `failed` (Fehler), `manual` (manuelle Bearbeitung).
   - **Gästekarte:** `not-applicable`, `waiting`, `requested`, `issued`, `delivered`, `failed`, `manual`.
   - Eine Spur ändert nie die andere.
4. **Lebenszyklus** (`planOfficialRegistration`, eine Operation pro Lauf):
   - Vor der Anreise wird eine Voranmeldung angelegt (falls unterstützt). Bei Änderungen wird sie aktualisiert.
   - Am Anreisetag wird sie in einen verbindlichen Meldeschein umgewandelt. Ohne Voranmeldung wird der Meldeschein an diesem Tag direkt angelegt.
   - Während des Aufenthalts ist nur eine Änderung der Abreise erlaubt, und nur wenn sie dokumentiert unterstützt wird.
   - Nach der Abreise, oder wenn Apaleo „checked-out“ meldet, folgt die Abmeldung.
   - **Stornierung bzw. No-Show in Apaleo:**
     - Eine Voranmeldung wird gelöscht.
     - Ein verbindlicher Meldeschein wird storniert, wenn das dokumentiert ist; sonst übernimmt das Team.
   - Jede andere Änderung an einem verbindlichen Meldeschein übernimmt das Team (`registration-immutable`).
5. **Fähigkeiten statt Annahmen.** Jede Operation hat ein Flag in `ProviderCapabilities`. `FERATEL_DOCUMENTED_CAPABILITIES` ist komplett `false`, bis die offizielle Dokumentation vorliegt. Mit dem echten Adapter wird also nichts gesendet, sondern alles geht an das Team (`not-supported`). Nur die Simulation setzt Flags auf `true`.
6. **Freigabeschranke (Gate):** Gemeldet wird nur, wenn alle Bedingungen gelten:
   - Der globale Modus (`disabled`/`simulated`) passt zur Umgebung des Objekts.
   - Das Objekt ist freigeschaltet und ein **Testobjekt**.
   - Die Registrierung ist abgesendet.
   - Der Check-in ist vollständig: Daten, verantwortliche Person ≥ 18, E-Mail bestätigt oder freigestellt (ADR 0021).

   Die Modi `test` und `production` sind in F1 **nicht konfigurierbar**: Das Schema lehnt sie ab.

7. **Wann Änderungen erkannt werden:**
   - Die Aufenthaltsdaten kommen bei jedem Lauf neu aus Apaleo (`stayFactsFromReservation`). Maßgeblich sind die lokalen Daten in der Zeitzone des Objekts.
   - Ein Fingerprint der Nutzdaten zeigt, ob sich etwas geändert hat.
   - Ein zweiter Fingerprint ohne Reisedaten trennt „nur die Abreise hat sich geändert“ von „die Gästedaten haben sich geändert“.
8. **Idempotenz und doppelte Meldungen:**
   - Jede Operation bekommt einen Schlüssel: `sha256(Registrierung | Operation | Fingerprint)`.
   - Die eigene Referenz ist `up-<registrationId>` und enthält keine personenbezogenen Daten.
   - Ein **anlegender** Aufruf mit unklarem Ausgang (Zeitüberschreitung, Absturz) wird **nicht wiederholt**:
     - Er wird als `unresolved` gemerkt.
     - Danach folgt ein Abgleich per Referenzabfrage (falls unterstützt), sonst übernimmt das Team.
     - „Erneut übertragen“ ist erst möglich, wenn der unklare Fall aufgelöst ist.
9. **Fehler und Wiederholungen:**
   - Vorübergehende Fehler werden mit dem vorhandenen Backoff wiederholt (1 min bis 6 h, höchstens 8 Versuche, danach `failed`).
   - Abgelehnte Daten und Rechtefehler führen sofort zu `failed`.
   - Nicht unterstützte Operationen führen zu `manual`.
10. **Datenminimierung:**
    - Übertragen werden nur die Meldefelder der Reisenden und die _bestätigte_ E-Mail des Hauptgasts (für die Gästekarte).
    - Keine Telefonnummern.
    - Kinder werden über das Alter am Anreisetag markiert.
11. **Protokoll:**
    - Pro Vorgang wird festgehalten: Zeitpunkt, Operation, Ergebnis, Fehlercode, Versuch, Idempotenzschlüssel, Akteur (System oder Admin-ID) und die Stufe bzw. der Status danach.
    - Personenbezogene Daten und Antworttexte des Ziels werden nie protokolliert. Logs enthalten nur IDs und Codes.
12. **Admin-Aktionen** (`requestRetry`, `resolveManually`, `updateGuestCard`):
    - Erneut übertragen ist nur aus `failed` oder `manual` möglich.
    - Bei einer manuellen Erledigung (z. B. im Webclient) werden Stufe und optional eine Referenz erfasst.
    - Alle Aktionen werden mit Admin-ID protokolliert.

## Umsetzung F0 (2026-11-05)

- [Anfrage an feratel](../integrations/feratel-anfrage-visitor-registration-interface.md) ist versandfertig. Sie fragt nach:
  - Dokumentation, Testzugang, Mapping-Codes, Freigabeprozess und Kosten;
  - Voranmeldung, Meldeschein, Änderungen, Abmeldung, Storno, Referenzabfrage;
  - Gästekarten und Datenschutz.

  Dazu gibt es Kurzanfragen an Montafon Tourismus bzw. die Gemeinde Gaschurn, an Alpenregion Bludenz Tourismus bzw. die Stadt Bludenz und an die Stadt Lindau.

## Umsetzung F1 (2026-11-05, nur simuliert)

- `packages/core/src/official-registration/`:
  - `model.ts`: Stufen, Status, Gästekarte, Operationen, Fähigkeiten, Zustand, Protokoll
  - `stay-facts.ts`: Apaleo-Reservierung → lokale Daten, Storno und No-Show
  - `payload.ts`: Nutzdaten, Fingerprints, Idempotenzschlüssel
  - `gate.ts`: Freigabeschranke
  - `planner.ts`: nächster Schritt
  - `outcome.ts`: Ergebnis anwenden, Backoff, Unklarheit
  - `provider.ts`: Port
  - `admin-actions.ts`: Aktionen des Teams
  - `run.ts`: ein Lauf mit Planen, Ausführen und Anwenden
- `packages/integrations/src/feratel/`:
  - `feratel-transport.ts`: Port, **ohne** Endpunkte oder Formate
  - `feratel-capabilities.ts`: dokumentierte Fähigkeiten, derzeit keine
  - `feratel-official-registration-provider.ts`: eigener Adapter, akzeptiert nur den simulierten Transport
  - `simulated-feratel-transport.ts`: In-Memory-Simulation mit steuerbaren Fehlern

  Diese Teile sind nicht an Apps, Cron oder Datenbank angebunden.

## Konsequenzen

- Die Meldelogik ist vollständig testbar, ohne dass Daten das System verlassen.
- F4 muss nur den Transport nach offizieller Doku schreiben und die Fähigkeiten setzen. Planer, Gate, Idempotenz und Protokoll bleiben gleich.
- Wenn Lindau AVS nutzt, kommt ein zweiter Adapter hinter denselben Port.
- Persistenz (Tabellen für Zustand, Protokoll und Gästekarte) folgt in F2. Bis dahin entsteht keine Meldung, auch nicht simuliert, in Staging oder Produktion.

## Nächste Phasen (jeweils mit Freigabe)

| Phase | Inhalt                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2    | Staging-Tabellen `official_registrations` (Zustand, eindeutig je Registrierung und Ziel), `official_registration_events` (nur Anhängen), Konfiguration je Objekt, RLS/Revoke |
| F3    | Fehlende Meldefelder nach der Feldliste von feratel; Vorlagen AT (Gaschurn, Bludenz) und DE (Lindau)                                                                         |
| F4    | Echter Transport nach Doku, nur gegen die feratel-Testumgebung; Fähigkeiten aus der Doku                                                                                     |
| F5    | Worker und Cron: Apaleo-Abgleich für offene Aufenthalte                                                                                                                      |
| F6    | Admin: Status je Reservierung, erneut übertragen, manuell, Protokoll, Filter je Objekt                                                                                       |
| F7    | Gästekarte: Status aus der Schnittstelle, Hinweis in der App                                                                                                                 |
| F8    | Abnahme durch feratel, Pilot ΛLPILΛ, dann HŪSLE, dann LÆKE                                                                                                                   |
