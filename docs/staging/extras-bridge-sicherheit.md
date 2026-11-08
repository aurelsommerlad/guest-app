# Extras-Brücke: Staging-Sicherheit

Stand: 08.11.2026. Erhoben über die Vercel-API und die Supabase-API (nur Namen, Ziele und Zuordnungen, keine Werte) sowie aus dem Code. Dieses Dokument enthält keine Secrets.

## 1. Vercel-Umgebungen

| Projekt                        | Production                                                                                              | Preview                                                                                         | Custom Environments |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| `guest-app` (STAY Gäste-App)   | **Nicht in Betrieb:** keine Production-Variablen, das einzige Production-Deployment ist fehlgeschlagen. | Branch-Deployments (`claude/sharp-rubin-hwfdyt`), SSO-geschützt.                                | keine               |
| `guest-app-admin` (STAY Admin) | Variablen für Production **und** Preview identisch.                                                     | wie Production                                                                                  | keine               |
| `guest-services` (Extras)      | `extras.unique-places.com`, Branch `claude/apaleo-upsell-app-8cdld6`                                    | Branch-Deployments, SSO-geschützt; für `claude/stay-api-bridge` per `vercel.json` abgeschaltet. | keine               |

Hinweis zu `guest-app`: Die Domain `stay.unique-places.com` ist dem Projekt zugeordnet. Solange es keine erfolgreiche Production-Bereitstellung gibt, läuft dort keine STAY-Version mit Produktivdaten.

## 2. Datenbanken und KV-Stores

| System         | Speicher                                                                                                                       | Production / Preview                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| STAY Gäste-App | Supabase `unique-places-guest-staging` (`sbefteauzxqqyynnocug`)                                                                | nur Preview gesetzt                               |
| STAY Admin     | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                                                    | **dieselben Werte für Production und Preview**    |
| Extras         | **ein** Vercel-KV/Upstash-Store (`store_kEBblHp7…`): Katalog, Bestellungen, Anfragen, Verlängerungen, Prüfprotokoll der Brücke | **Production und Preview teilen denselben Store** |

Im Supabase-Konto gibt es außer dem Staging-Projekt nur `space-anfrage`, aber kein STAY-Production-Projekt.

## 3. Sind Staging und Production getrennt?

**Nein, nicht vollständig.**

- **Extras (kritisch):** Ein Preview-Deployment von guest-services würde in den **produktiven KV-Store** schreiben:
  - Anfragen (sichtbar in der produktiven Admin-Warteschlange),
  - Bestellungen,
  - Prüfprotokoll der Brücke.

  Außerdem nutzt es **dieselben Apaleo-Zugangsdaten** wie Production und dasselbe `JWT_SECRET`.

- **STAY Gäste-App:** In der Praxis getrennt. Es läuft nur Staging (Supabase-Staging, eigene Apaleo-Zugangsdaten in Preview).
- **STAY Admin:** Production und Preview nutzen dieselbe Datenbank. Solange die Gäste-App keine Production hat, ist das die Staging-Datenbank. Vor einem STAY-Go-live muss das getrennt werden.

**Voraussetzung für ein Staging-Deployment der Brücke:** ein eigenes Vercel-Projekt `guest-services-staging`, verbunden mit dem Repository, mit

- einem **eigenen** KV-Store,
- **ohne** Slack-Variable,
- eigenem `JWT_SECRET`,
- `STAY_BRIDGE_PROPERTY_IDS=TEST`.

Das Production-Projekt bleibt unverändert. Die Alternative wäre, die Preview-Variablen des bestehenden Projekts umzustellen; das würde aber Einstellungen des produktiven Projekts verändern.

## 4. Apaleo-Berechtigungen

| App                   | Benötigte Scopes                                                                                                                                                   | Schreibend                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Extras (inkl. Brücke) | `reservations.read reservations.manage offers.read setup.read folios.read availability.read` (fest im Code angefordert)                                            | `book-service` (Leistungen), `amend` (Zusatzperson, Verlängerung), `PATCH` (Kommentar, Kennzeichen) |
| STAY Gäste-App        | lesend: `reservations.read`, `folios.read`; `reservations.manage` nur für den Check-in-Rückschrieb, der deaktiviert ist (`APALEO_REGISTRATION_WRITEBACK=disabled`) | keine. Buchungen laufen ausschließlich über Extras.                                                 |

Apaleo-Zugangsdaten gelten **für das gesamte Konto**, nicht pro Objekt. Ein Scope lässt sich nicht auf `TEST` beschränken.

## 5. Wie verhindern wir Schreibzugriffe auf echte Reservierungen?

**Mehrere Ebenen, die alle gleichzeitig greifen müssen:**

1. **STAY:** Die Brücke ist nur für Objekte mit `testOnly`, Design V2, `upsell: "v1"` und `extras: "bridge"` aktiv, also derzeit nur `test-run`. Echte Objekte rufen die Brücke nie auf.
2. **STAY-Token:** Mandant, Apaleo-Property und Reservierung stammen ausschließlich aus dem serverseitigen Gastkontext, nie aus dem Browser.
3. **Brücke:**
   - `STAY_BRIDGE_PROPERTY_IDS=TEST` (Allow-List) und `STAY_BRIDGE_TENANT`;
   - die Reservierung wird bei Apaleo geladen und muss zur Property `TEST` gehören;
   - sonst Antwort 403 ohne jeden Schreibzugriff.
4. **Brücke aus, solange nicht konfiguriert:** Production hat keine `STAY_BRIDGE_*`-Variablen, dort antworten alle Routen mit 404.
5. **Tests und lokale Läufe:** Apaleo-Simulator. Jeder andere Host ist blockiert.
6. **Erster echter Test:** nur nach Freigabe, nur `JTKQSYFX-1`, nur eine Leistung, mit Rücknahme (siehe Testplan).

Was bleibt: Die öffentlichen Extras-Endpunkte haben **dieselben** Zugangsdaten und können jede Reservierung buchen, deren Nummer und Nachname bekannt sind. Das ist das bestehende, gewollte Verhalten der Extras-App und unabhängig von der Brücke.

## 6. Wie bleibt Slack deaktiviert?

- In Extras sendet nur `notifyNewRequest`. Ohne `SLACK_REQUEST_WEBHOOK_URL` passiert nichts; das Log zeigt `[Slack] webhook configured: false`.
- Die Variable ist derzeit **nur für Production** gesetzt, nicht für Preview.
- Für `guest-services-staging` wird sie nicht angelegt.
- Kontrolle vor jedem Test: Variablenliste des Projekts ansehen (nur Namen) und nach der ersten Anfrage die Log-Zeile prüfen.
- Lokal: Die Variable ist leer, und der Simulator blockiert `hooks.slack.com`.

## 7. Fehlende Umgebungsvariablen

**guest-services (Staging-Projekt, neu):**

- `APALEO_CLIENT_ID`, `APALEO_CLIENT_SECRET`, `JWT_SECRET` (eigenes);
- KV-Store (eigener, über die Vercel-Integration);
- `STAY_BRIDGE_ENABLED=true`, `STAY_BRIDGE_SECRET`, `STAY_BRIDGE_TENANT=unique-places`, `STAY_BRIDGE_PROPERTY_IDS=TEST`;
- `APP_BASE_URL` (optional);
- `SLACK_REQUEST_WEBHOOK_URL` **nicht** setzen.

**STAY Gäste-App (Preview):**

- `EXTRAS_BRIDGE_URL` (URL des Staging-Projekts) und `EXTRAS_BRIDGE_SECRET` (gleicher Wert wie `STAY_BRIDGE_SECRET`);
- `EXTRAS_BRIDGE_PROTECTION_BYPASS`, nur falls das Extras-Staging-Projekt SSO-geschützt bleibt;
- `EXTRAS_APP_URL` (optional, Fallback-Link).

**Für den ersten echten Test (lokal, ohne Deployment):** Apaleo-Zugangsdaten von Extras als Umgebungsvariablen dieser Cloud-Umgebung (Einstellungen der Umgebung, nicht über den Chat), z. B. `EXTRAS_TEST_APALEO_CLIENT_ID` und `EXTRAS_TEST_APALEO_CLIENT_SECRET`.
