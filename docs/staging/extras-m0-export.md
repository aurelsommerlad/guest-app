# M0: Lesender Export der Extras-Daten

Stand: 08.11.2026. **Vorbereitet. Der produktive KV-Store wurde nicht gelesen.** Vor dem ersten Zugriff ist eine gesonderte Freigabe nötig.

## Was exportiert wird

| Bestand             | Schlüssel                                                              | Hinweis                                                                            |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Objekte / Kataloge  | `catalog:{apaleoPropertyId}:items` (Hash), Alt: `catalog:{id}` (Array) | alle Service-Einstellungen inkl. Preisregeln, Apartmenttypen, Kapazität, Overrides |
| Verlängerung        | `extension-night:config:{id}`                                          | Rabatte, Mindestnächte, Altfelder                                                  |
| Bilder              | `image:{uuid}`                                                         | base64 + Format                                                                    |
| Benutzer und Rollen | `users`                                                                | **ohne Passwort-Hash**                                                             |
| Bestellungen        | `orders`                                                               | ohne Gastnamen                                                                     |
| Anfragen            | `requests:items`                                                       | ohne Gastnamen und E-Mail                                                          |
| Verlängerungen      | `stay-extensions:records`                                              |                                                                                    |
| nur gezählt         | `ratelimit:*`, `*:claim:*`, `request:*`, `stay-bridge:*`               | kurzlebige Sperren/Zähler; Sperren ohne Ablauf werden als Auffälligkeit gemeldet   |

Felder mit Namen wie `guestName`, `guestEmail`, `email`, `phone`, `passwordHash`, `password`, `token`, `plate(s)`, `firstName`, `lastName`, `comment`, `note`, `address` werden **beim Export** entfernt; der Bericht zählt nur, wie oft.

## Sicherheit

- Der Leser sendet ausschließlich `SCAN`, `TYPE`, `GET`, `HGETALL`, `TTL`, `DBSIZE` (Allowlist im Code, jeder andere Befehl wird vor dem Senden abgewiesen; Test vorhanden). Kein `KEYS`.
- Akzeptiert wird nur `KV_REST_API_READ_ONLY_TOKEN`. Ist nur der Schreib-Token (`KV_REST_API_TOKEN`) gesetzt, bricht das Werkzeug ab.
- Produktion nur mit ausdrücklichem `--confirm-production-read`; Ausgabe muss außerhalb des Repositorys liegen; Dateien mit Rechten 0600.
- Ergebnis: `snapshot.json` (minimiert), `manifest.json` (SHA-256 je Schlüssel + Gesamtprüfsumme), `report.md` (nur Zahlen, Konfigurationswerte, Service-/Objekt-IDs, Auffälligkeiten).
- Wiederholbar: unveränderte Daten ergeben dieselben Prüfsummen (Test vorhanden); `verifySnapshot` erkennt geänderte, fehlende und zusätzliche Einträge.

## Benötigte Berechtigungen (für die Freigabe)

1. **Lesender Zugriff auf den Extras-KV-Store** (Vercel-Projekt `guest-services`, Upstash-Store der Produktion): die Werte von `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN`. Sie werden **nicht** im Chat übergeben, sondern lokal bzw. in einer gesicherten Umgebung als Umgebungsvariablen gesetzt (z. B. per `vercel env pull` durch eine berechtigte Person).
2. Kein Schreib-Token, keine Apaleo-Zugangsdaten, kein Slack.
3. Ein sicherer Ablageort für den Snapshot außerhalb des Repositorys (enthält Katalog, Konfiguration, Benutzernamen für die Einladungsliste, Reservierungsnummern).

Hinweis: Produktion und Preview von guest-services teilen sich denselben KV-Store (siehe `docs/staging/extras-bridge-sicherheit.md`). Auch ein Lesen über Preview ist daher ein Zugriff auf Produktionsdaten.

## Ausführen

Probelauf ohne Produktionszugriff:

```bash
pnpm --filter @up/admin extras:export --source fixture --out /pfad/ausserhalb
pnpm --filter @up/admin extras:export --source local --file ../guest-services/.data/db.json --out /pfad/ausserhalb
```

Nach Freigabe (Produktion, nur lesend):

```bash
KV_REST_API_URL=… KV_REST_API_READ_ONLY_TOKEN=… \
  pnpm --filter @up/admin extras:export --source kv --confirm-production-read --out /pfad/ausserhalb
```

Danach Import auf einer isolierten Datenbank (lokal oder Staging, nie Produktion):

```bash
DATABASE_URL=… pnpm --filter @up/admin extras:import --target local|staging --tenant unique-places \
  --snapshot /pfad/snapshot.json --manifest /pfad/manifest.json [--apply] --report /pfad/import.md
```

## Probelauf mit synthetischen Daten (08.11.2026)

- Export: 11 Schlüssel, Prüfsumme reproduzierbar, entfernte Felder: `guestName` 4, `guestEmail` 2, `passwordHash` 3.
- Bericht erkennt u. a.: Zusatzperson ohne Preis, nur alter Array-Katalog, Altfelder der Verlängerung, ungenutzte Bilder, Sperre ohne Ablauf, Obergrenze 500 Bestellungen.
- Import auf isolierter Postgres-16-Datenbank: Probelauf ohne Änderungen, erste Übernahme, zweite Übernahme vollständig „unverändert“.
