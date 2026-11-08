# Schattenbetrieb M3: Paritätsbericht Extras ↔ STAY

Stand: 08.11.2026 · Branch `claude/sharp-rubin-hwfdyt`. Extras bleibt bis zum gemeinsamen Go-live führend. Es gab keinen produktiven Zugriff: keine Apaleo-Schreibzugriffe, kein Slack, kein KV-Store, keine Änderung an guest-services.

Rohdaten jedes Laufs (maschinenlesbar): [`extras-migration-m3-paritaet.json`](extras-migration-m3-paritaet.json). Automatisch erzeugte Abweichungsliste: [`extras-migration-m3-paritaet-lauf.md`](extras-migration-m3-paritaet-lauf.md). Neu erzeugen mit:

```
pnpm --filter @up/shadow parity     # EXTRAS_REPO=<Pfad zu guest-services>, Standard ../guest-services
```

## Verfahren

| Baustein | Umsetzung |
| --- | --- |
| Extras-Seite | Die echten Extras-Funktionen aus `lib/guest.js`, `lib/requests.js` und `lib/apaleo.js` werden **nur lesend** aus dem lokalen guest-services-Checkout importiert: `getGuestCatalog`, `placeGuestOrder`, `getStayExtensionOffer`, `confirmStayExtension`, `createGuestRequest`, `approveRequest`. Daten liegen in einem temporären lokalen JSON-Speicher. KV- und Slack-Variablen werden vor dem Import entfernt. |
| STAY-Seite | `ServiceBookingEngine` (`packages/integrations/src/services/booking-engine.ts`) mit PGlite-Datenbank. Gateway im Modus **simuliert**. |
| Datenweg nach STAY | Ausschließlich über den M1-Import (`importExtrasSnapshot`). Die Konfiguration wird nicht von Hand angelegt. |
| Apaleo | Für beide Seiten derselbe guest-services-Simulator: Objekt TEST, Reservierung JTKQSYFX-1, Stand 08.11.2026. Er ersetzt `fetch` und weist jeden anderen Host ab. STAYs simulierte Gateway-Befehle wirken auf denselben Simulatorzustand. So lässt sich auch der Endzustand vergleichen. |
| Vergleich | Feld für Feld, ohne Ausnahmen:<br>• angezeigte Services und Reihenfolge<br>• Preise, Nächte, Daten<br>• Verfügbarkeit, Mengenlimits, Einschränkungen<br>• Texte<br>• Verlängerungsangebot (Phase, Lücke, Rabatt, Zusatzleistungen, Summe)<br>• Buchungsergebnis, Anfrageergebnis<br>• Endzustand in Apaleo: Services, Abreise, Erwachsene, Nachtpreise, Kennzeichen, Kommentar, Folge der Schreibvorgänge |

Normalisiert werden nur drei technische Dinge, die keine fachlichen Werte betreffen:

- Zeitstempel im Kommentar.
- Token-Abruf.
- Befehlsnamen: STAY `amend-stay` und Extras `PUT …/amend` sind derselbe Apaleo-Aufruf.

## Ergebnis

17 Szenarien. In den **fachlichen Buchungsergebnissen** sind alle identisch, außer zwei echten Befunden (P-1 und P-2). Abweichende **Texte** sind ein dritter Befund (P-3).

| Szenario | Preise / Verfügbarkeit / Buchung / Endzustand | Texte |
| --- | --- | --- |
| S01 Standardreservierung: Katalog und Verlängerungsangebot | identisch | P-3 |
| S02 Hund bereits in Apaleo gebucht (`maxQuantity` 0, `alreadyBooked`, Bestellung abgewiesen) | identisch | P-3 |
| S03 Keine Restkapazität (Zusatzperson ausgeblendet, Bestellung abgewiesen) | identisch | P-3 |
| S04 Apartmenttyp für Parken nicht erlaubt (angezeigt, gesperrt, abgewiesen) | identisch | P-3 |
| S05 Vergangener Aufenthalt (leerer Katalog, kein Angebot) | identisch | – |
| S06 Geänderter Apaleo-Preis (25 € statt 20 € angezeigt und gebucht) | identisch | P-3 |
| S07 Mehrtägig: Hund, 2 Parkplätze mit 2 Kennzeichen, Früher Check-in, 2 Zusatzpersonen | identisch, auch die Folge der 7 Schreibvorgänge | – |
| S08 Ungültige Positionen: Kapazität, Hund ×2, fehlendes Kennzeichen, Anfrage-Service | identisch, gleiche Fehlergründe | – |
| S09 Verlängerung mit Hund und bestehendem Late Check-out | identisch:<br>• Nacht 89,10 €<br>• Hund verlängert<br>• LCO auf neue Abreise<br>• Endreinigung verschoben<br>• Status `confirmed` | – |
| S10 Verlängerung im Haus (Rabatt im Haus) | identisch | – |
| S11 Folgenacht ausgebucht: kein Angebot | identisch | – |
| S12 Lücke von genau einer Nacht: Lückenrabatt 15 %, 84,15 € | identisch | – |
| S13 Anfrage Babybett anlegen und bestätigen (ein book-service, Kommentar) | identisch | – |
| S14 Anfrage mit zu geringer Verfügbarkeit: Bestätigung abgewiesen | identisch | – |
| S15 Historischer Wahrheitswert `"false"` | **P-1** | – |
| S16 Zusatzperson mit leerem Preis | **P-2** | P-3 |
| S17 Inaktiver Eintrag, fehlende Reihenfolge | identisch | P-3 |

## Abweichungen: Ursache und fachlich richtige Lösung

Keine Abweichung wurde stillschweigend angeglichen. STAY zeigt in P-1 und P-2 das sicherere Verhalten. Bis zur Entscheidung gilt in Extras weiter das bisherige Verhalten.

### P-1 `extensionNightEnabled: "false"` (Text) schaltet in Extras die Verlängerung **ein**

- **Beobachtung:** Extras bietet die Verlängerung an. STAY bietet sie nicht an.
- **Ursache:** Extras liest den Wert mit `Boolean(stored.extensionNightEnabled)` (`lib/store.js` `getExtensionConfig`). Jeder nicht leere Text ist dort `true`, auch `"false"`. STAY normalisiert historische Werte (`normalizeBoolean`, M2). Der Import meldet das als `boolean_normalized:extensionNightEnabled`.
- **Fachlich richtig:** `"false"` bedeutet „aus“.
- **Lösung:** STAY-Verhalten beibehalten. Vor dem Go-live in M0 prüfen, ob produktive Objekte einen Textwert gespeichert haben. Falls ja, mit dem Objekt klären, ob die Verlängerung heute tatsächlich angeboten wird. Den Wert in STAY ausdrücklich setzen. Extras bleibt unverändert, bis guest-services freigegeben ist.

### P-2 Zusatzperson mit leerem Preis: Extras bietet sie **kostenlos** an

- **Beobachtung:** Extras zeigt „Zusatzperson“ für 0,00 € an und würde sie buchen (+1 Erwachsener ohne Aufpreis). STAY blendet sie aus (`invalid_extra_person_price`).
- **Ursache:**
  - Extras `buildExtraPersonPricing` rechnet `Number("") = 0`. Damit gilt der Preis als gültig.
  - Die M1-Portierung prüft leere Werte ausdrücklich und verwirft sie. Der Import meldet `config_error:missing_extra_person_price`.
  - Dass die Portierung hier vom Live-Verhalten abweicht, wurde erst durch den Paritätslauf sichtbar.
- **Fachlich richtig:** Ein fehlender Preis ist ein Konfigurationsfehler, kein Gratisangebot.
- **Lösung:**
  - STAY-Verhalten beibehalten. Der Admin zeigt den Konfigurationsfehler, der Eintrag ist nicht buchbar.
  - In M0 produktive Kataloge auf leere Preise prüfen und die Objekte informieren.
  - Optional Extras korrigieren (Freigabe guest-services nötig).

### P-3 Texte: STAY zeigt redaktionelle Texte, Extras die Apaleo-Übersetzung

- **Beobachtung:**
  - Ohne eigene Extras-Beschreibung zeigt Extras die in Apaleo gepflegte Beschreibung („Dog fee“, „Car park“).
  - STAY zeigt den Angebots-Teaser. Beim Import ist das der deutsche Titel, im Englischen fällt er auf Deutsch zurück.
  - Bei Namen ohne englischen Override gilt dasselbe (S16/S17: „Endreinigung“).
- **Ursache:**
  - Extras löst Texte über Override → Apaleo-Übersetzung → Katalogtext auf.
  - STAY führt Texte redaktionell (Angebot und Standort-Override, M2) und fragt Apaleo nicht nach Texten.
  - Der Import übernimmt nur die Extras-Overrides.
- **Fachlich richtig:**
  - Gäste sehen in ihrer Sprache denselben oder einen besseren Text als heute.
  - Englisch darf nicht unbemerkt auf Deutsch zurückfallen.
- **Lösung (vorgeschlagen für M4, nicht umgesetzt):**
  - Beim Import fehlende Titel und Beschreibungen einmalig aus der Apaleo-Übersetzung vorbelegen (lesender Abruf `languages=de,en`), Herkunft im Importbericht.
  - Im Admin fehlende englische Texte als „Übersetzung fehlt“ markieren.
  - Bis dahin redaktionell ergänzen.
  - Preise, Verfügbarkeit und Buchungen sind davon nicht betroffen.

## Bereits bei der Übernahme gefundene und behobene Abweichung

**P-0: Service-Offers mit `onlyDefaultDates=false`.**

- **Ursache:** Der M1-Reader von STAY fragte Apaleo mit `onlyDefaultDates=false` ab. Extras sendet keine Parameter. Damit konnte Apaleo zusätzliche Nicht-Standarddaten liefern, und `findDefaultServiceDate`/`resolveRequiredDates` hätten bei `per_stay` andere Daten wählen können.
- **Lösung:** angeglichen. STAY fragt wie Extras ohne Parameter ab. Neu: `getServiceOffersForStay` mit derselben Regel für vergangene Aufenthalte (Abreise vor heute oder Apaleo-422).
- **Prüfung:** S01–S17.

## Bewusste Unterschiede (nicht Teil der Parität, weil Extras sie nicht kennt)

| Thema | Extras | STAY | Grund |
| --- | --- | --- | --- |
| Schreibweg | direkter Apaleo-Aufruf | jedes Schreiben über das Gateway:<br>• Idempotenzschlüssel je Schreibvorgang<br>• Richtlinie (Modus, Schreiber, Objekt-Freigabe, Reservierung des Objekts)<br>• Protokoll | Nachvollziehbarkeit, keine Doppelbuchung bei Wiederholung |
| Sperren | `setIfNotExists` **ohne Ablauf**: Nach einem Absturz bleibt die Sperre für immer stehen (z. B. kein zweiter Hund, keine Verlängerung mehr) | `service_locks` mit 120 s Ablauf | Verhindert dauerhaft blockierte Reservierungen |
| Doppelklick bei der Bestellung | zweiter Klick läuft erneut durch, durch Sperren und Neuprüfung meist abgefangen | Client-Idempotenzschlüssel:<br>• gleiche Bestellung → gespeichertes Ergebnis<br>• parallel → „in Bearbeitung“<br>• abgebrochen → Fortsetzung nach 120 s | Kein doppelter Kommentar, keine doppelte Benachrichtigung |
| Preisänderung zwischen Anzeige und Buchung | bucht den neuen Preis ohne Rückfrage | wie Extras, wenn die Oberfläche keinen Preis mitschickt. Mit `expectedUnitPrice`: Position mit `price_changed` abgewiesen, nichts geschrieben | Gast bestätigt nie einen anderen Preis als angezeigt |
| Veröffentlichung | `active` genügt | zusätzlich: Angebot in STAY veröffentlicht. Der Schattenvergleich wertet Entwürfe ein (`includeUnpublished`) | Redaktionelle Freigabe vor dem Go-live |
| Slack | direkt an den Webhook | nur in die Ausgangswarteschlange (`notification_outbox`, Status `pending`). Es gibt keinen Versand | Keine produktiven Slack-Nachrichten vor M4 |
| Verlängerung im Modus „simuliert“ ohne Zustand | – | Ohne Simulator-Zustand ändert sich Apaleo nicht. Die Prüfung nach dem Schreiben wird als „nicht prüfbar“ (`skipped_simulated`) gespeichert, nie als bestätigt | Keine falsche Erfolgsmeldung |
| Zeitstempel im Kommentar | Zeitzone des Servers (Vercel: UTC) | Europe/Berlin | Lesbarkeit für das Team |

## Gleich übernommene Lücken (für M4 vorgeschlagen, nicht still geändert)

- **Anfragen:** Extras prüft beim Anlegen weder Menge noch Hundelimit, erst bei der Bestätigung. STAY übernimmt das 1:1.
  - Vorschlag M4: bereits beim Anlegen gegen `maxQuantity` prüfen.
- **Bestätigung einer Anfrage:** Bucht ohne `amount`, also zum aktuellen Apaleo-Preis. Der angezeigte Preis (`quotedCents`) wird nicht verglichen. STAY übernimmt das 1:1.
  - Vorschlag M4: Abweichung beim Bestätigen anzeigen.
