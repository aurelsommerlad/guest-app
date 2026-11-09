# Adminfehler und Extras-Darstellung in STAY

Stand: 09.11.2026 · Branch `claude/sharp-rubin-hwfdyt` · Screenshots: [`extras-ui-screenshots/`](extras-ui-screenshots/)

Vorgaben eingehalten:

- Keine produktiven Apaleo-Schreibzugriffe.
- Keine Änderung an der Extras-App.
- Keine Migration auf Production.
- Keine Daten verändert oder gelöscht.
- M5 nicht begonnen.

## 1. Ursache des Adminfehlers und Korrektur

**Logs (Vercel, Projekt `guest-app-admin`, Deployment `dpl_8U7p4…`, Branch `claude/sharp-rubin-hwfdyt`):** Alle Fehler waren `column … does not exist` (Postgres 42703).

| Route                                     | Fehlende Spalte                                    | Migration |
| ----------------------------------------- | -------------------------------------------------- | --------- |
| `/services/[propertyId]` (Servicekatalog) | `offer_properties.extras_texts`                    | 0021      |
| `/requests/[propertyId]` (Anfragen)       | `offer_requests.idempotency_key`                   | 0020      |
| `/notifications`                          | `notification_outbox.delivery_mode`                | 0020      |
| `/extension-nights/[propertyId]`          | `property_service_settings.slack_decision_updates` | 0020      |

Die Gäste-App hatte denselben Grund: Seit 06:12 schlug „offer catalog could not be loaded“ für `test-run` fehl.

**Datenbank:** Das Deployment nutzt die Staging-Datenbank `unique-places-guest-staging`. Belegt ist das durch eine Admin-Sitzung um 07:40:23 und den ersten Fehler um 07:40:44. Die Datenbank stand auf Migration 0018.

**Warum fehlten 0019–0022?**

- Der Workflow `Database · Staging` soll Migrationen bei jedem Push automatisch einspielen.
- Er ist seit seinem ersten Lauf fehlgeschlagen, weil in GitHub `STAGING_DATABASE_URL` und `STAGING_SUPABASE_PROJECT_REF` nicht hinterlegt sind.
- 0018 war per geprüftem SQL-Skript eingespielt worden, 0019–0022 nie.
- Der Code dieses Branches wird aber bei jedem Push automatisch deployt.

**Korrektur:**

1. `W-migration-0019-0022.sql` erstellt: unveränderte Drizzle-Migrationen plus Journal-Einträge.
2. Lokal geprüft: Datenbank auf Stand 0018 → Skript → Schema identisch mit einer vollständig migrierten Datenbank. Ein zweiter Lauf bricht ab.
3. Vorab auf Staging geprüft: 0 Anfragen, 8 Konfigurationen, 0 Meldungen; keine Daten verletzen die neuen Regeln.
4. Auf Staging angewendet (nicht Production). Ergebnis: 23 Migrationen eingetragen, alle neuen Spalten vorhanden, Konfigurationen unverändert.
5. Die zuvor fehlgeschlagenen Abfragen laufen jetzt auf Staging durch.

Lokal laden Servicekatalog, Anfragen, Verlängerungsnächte, Benachrichtigungen und eine Service-Konfiguration fehlerfrei (Screenshots a01–a06).

**Offen:** Damit das nicht wieder passiert, braucht der Workflow `Database · Staging` die beiden Werte in den GitHub-Einstellungen der Umgebung `staging`.

## 2. Wo Extras und Verlängerungsnächte in STAY erscheinen

Navigation „Stay“ → „Services & Erlebnisse“ (`/v2/services`), Kapitel „01 Für Deinen Aufenthalt“:

1. **Verlängerungsnacht ganz oben:**
   - Nur wenn die Quelle sie für die Reservierung anbietet, also bei Verfügbarkeit, gemäß den Standortregeln.
   - Angezeigt werden die neue Abreise, die Übernachtung mit durchgestrichenem Originalpreis, der Rabatt, der Gesamtpreis inklusive verlängerter Leistungen und der Button „Nacht hinzufügen“.
   - Bestätigt wird auf der Detailseite mit vollständiger Aufstellung inklusive Kurtaxe (g02, g09).
2. **Alle Services darunter:**
   - Bild (wenn vorhanden), Titel, Beschreibung, Preis mit der konfigurierten Preiseinheit.
   - Aktion „Buchen“ oder „Anfragen“; bei Anfragen der Hinweis „Auf Anfrage“.
   - Status direkt am Service: „Bereits gebucht“, „Angefragt“, „Bestätigt“, „Leider nicht möglich“ – oder rot „In Deinem Apartment nicht möglich“, etwa bei einem Hund im falschen Apartmenttyp (g06–g08).
3. **Buchen auf der Servicedetailseite:**
   - Mengenwahl, wo Extras sie anbietet (Zusatzpersonen, Parkplätze, Anfragen).
   - Kennzeichen je Parkplatz.
   - Verbindlicher Preis, Buchungs- oder Anfragebutton (g04, g05).
   - Eingeschränkte Services zeigen den Grund statt eines Buttons (g03).
4. **„Gebucht & angefragt“** unten auf derselben Seite.

Alle Inhalte (Preise, Verfügbarkeit, Texte, Einschränkungen, Verlängerung) kommen live aus Apaleo und den Standorteinstellungen. Im Test war das der Apaleo-Simulator.

## 3. Warum die Angebote bei der Testbuchung fehlen

Zwei Ursachen, beide nicht in der Gästeoberfläche selbst:

1. **Datenbankfehler (behoben):** Seit 06:12 konnte die Gäste-App auf Staging den Katalog nicht laden (siehe 1). Die Seite zeigte nur leere Kapitel.
2. **Feature-Schalter nicht gesetzt:**
   - Die Vercel-Preview der Gäste-App hat weder `GUEST_SERVICE_ENGINE=test` (STAY-Engine, nur Objekt TEST) noch `EXTRAS_BRIDGE_URL`/`_SECRET` (Extras-Brücke).
   - Ohne eine der beiden Quellen zeigt STAY bewusst nur fest hinterlegte Vorschaupreise des TEST-Objekts: nicht buchbar, ohne Verlängerungsnacht, ohne Einschränkungen.
   - Das sind die „Testpreise“.
   - Ein realer Standort bekommt die STAY-Engine ohnehin nicht. Er bleibt bis zum Go-live auf der Extras-Brücke, und die ist für die Preview nicht konfiguriert.

**Damit es in der Preview funktioniert** (Entscheidung und Einstellung bei Dir, Vercel → `guest-app` → Environment Variables → Preview):

- `GUEST_SERVICE_ENGINE=test` und `APALEO_SERVICE_WRITES=simulated`: nur das Objekt TEST, Schreiben simuliert, keine Apaleo-Buchung.
- Der Apaleo-Zugang der Preview braucht Lesezugriff auf Reservierungen, Service-Angebote und Folios. Die Logs zeigen derzeit 403 für Folios (Zahlungsdaten); das betrifft die Kurtaxe-Vorschau der Verlängerung.

## 4. Was vollständig vorhanden ist

- Katalog je Standort mit Extras-Logik: Preise live aus Apaleo, Buchungsregeln, Datumslogik, Kapazität, Apartmenttypen, Hund maximal einmal, Kennzeichen, Zusatzpersonen, Anfrage oder Sofortbuchung.
- Verlängerungsnacht mit Lückenregel, beiden Rabattphasen, verlängerten Leistungen, verschobenem Late Check-out und Kurtaxe.
- Anfragen mit Prüfung beim Anlegen, verbindlicher Preisprüfung und Status für den Gast.
- „Gebucht & angefragt“ aus allen Quellen.
- **Neu in diesem Schritt:**
  - Verlängerungsnacht oben mit Originalpreis und Rabatt.
  - Eingeschränkte Services sichtbar mit Grund statt ausgeblendet.
  - Gebuchte und angefragte Services bleiben mit Status in der Liste.
  - Konfigurierte Preiseinheit statt Standardtext.
  - Bild und Beschreibung je Service in der Liste.

## 5. Noch bestehende Unterschiede zur Extras-App

| Thema                                                       | Extras                                                  | STAY                                                                          | Bewertung                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Mehrere Services in einem Schritt                           | Mengenwähler in der Liste, ein „Jetzt buchen“ für alles | je Service auf der Detailseite                                                | Entscheidung: sammeln wie Extras oder Einzelbuchung beibehalten |
| Mengenwahl bei normalen Services (z. B. 2× Früher Check-in) | überall möglich                                         | nur Zusatzpersonen, Parkplätze, Anfragen; höchstens 4                         | angleichbar, wenn gewünscht                                     |
| Bilder                                                      | Extras-Upload je Service                                | STAY-Bild am Angebot; Extras-Bilder kommen mit der Bildmigration              | Bildmigration beim Go-live                                      |
| Verlängerung in der Liste                                   | Aufstellung direkt in der Karte                         | Kurzfassung oben, volle Aufstellung auf der Detailseite                       | bewusst (Magazin-Design)                                        |
| Originalpreis der Nacht über die Extras-Brücke              | –                                                       | die Brücke liefert ihn nicht (nur die STAY-Engine); dann nur Rabatt und Preis | akzeptabel bis zum Go-live                                      |

## 6. Screenshots

**Gast** (lokal, Apaleo-Simulator, Objekt TEST, Engine „test“, Schreiben simuliert):

| Bild | Inhalt                     |
| ---- | -------------------------- |
| g01  | Desktop                    |
| g02  | Verlängerung, Detail       |
| g03  | Hund im falschen Apartment |
| g04  | Früher Check-in gebucht    |
| g05  | Babybett angefragt         |
| g06  | Liste mit Status           |
| g07  | Englisch                   |
| g08  | Mobil                      |
| g09  | Verlängerung mobil         |

**Admin:**

| Bild | Inhalt                |
| ---- | --------------------- |
| a01  | Start                 |
| a02  | Servicekatalog        |
| a03  | Anfragen              |
| a04  | Verlängerungsnächte   |
| a05  | Benachrichtigungen    |
| a06  | Service-Konfiguration |
