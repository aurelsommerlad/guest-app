# feratel Deskline 3.0 VT PMS Web Services: Analyse und Abgleich mit ADR 0022

Stand: 2026-11-05. Erstellt **nur lesend**: Es wurde keine Methode aufgerufen und es wurden keine Daten gesendet. Es gab keine Verbindung zu einer Import-Operation.

## Quellen und ihre Verlässlichkeit

| Quelle                                                                                                                                                                                             | Inhalt                                           | Verlässlichkeit                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| „Deskline 3.0 VT PMS Web Services“ **v1.0.4** (07.11.2018), öffentlich bei [Stadt Füssen](https://www.fuessen.de/fileadmin/userdaten/docs/service/meldewesen/Deskline_3_0_VT_PMS_Web_Services.pdf) | Methoden, XML-Elemente, Fehlercodes, Druck-Links | 2018, also veraltet                                                               |
| „… Acceptance test“ v1 (08.11.2018), [Füssen](https://www.fuessen.de/fileadmin/userdaten/docs/service/meldewesen/Deskline_3_0_VT_PMS_Web_Services_-_Acceptance_Test.pdf)                           | Pflicht-Testszenarien vor der Live-Freigabe      | 2018                                                                              |
| v1.0.6 (25.03.2019), Link bei schwangau.de                                                                                                                                                         | –                                                | **Nicht abrufbar (HTTP 404).** Die Änderungen von 1.0.5 und 1.0.6 sind unbekannt. |
| Live-Hilfeseiten und **WSDL** `https://visitortax.deskline.net/ProcessData.asmx?WSDL` (heute abgerufen)                                                                                            | aktuelle Operationen und Nachrichtenteile        | **aktuell (2026)**                                                                |
| Live-**XSD** `VT_VisitorRegistration_PMS.xsd`, `VT_ComplexTypes.xsd`, `VT_SimpleTypes.xsd` (heute abgerufen)                                                                                       | aktuelle Elemente und Attribute                  | **aktuell (2026)**                                                                |
| Test-WSDL `visitortaxtest.deskline.net`                                                                                                                                                            | –                                                | antwortet mit **HTTP 401**: Die Testumgebung existiert und ist geschützt          |

SHA-256-Präfixe der heute gelesenen Dateien (zur späteren Erkennung von Änderungen):

| Datei                            | Präfix             |
| -------------------------------- | ------------------ |
| WSDL                             | `b8a2144013eb59c7` |
| `VT_VisitorRegistration_PMS.xsd` | `bc0059586c872303` |
| `VT_ComplexTypes.xsd`            | `b35bcdf9df2f7158` |
| `VT_SimpleTypes.xsd`             | `7ec7dd7600c113af` |

Kennzeichnung im Folgenden:

- **[WSDL/XSD]**: durch die aktuellen Live-Schemata bestätigt.
- **[Doku 2018]**: nur in der alten Doku beschrieben.
- **[offen]**: muss feratel bestätigen.

---

## 1. ImportPMS und ImportPMSString

### ImportPMS [WSDL]

- SOAP 1.1 und 1.2, Namespace `http://feratel.com/visitorregistration`, SOAPAction `http://feratel.com/visitorregistration/ImportPMS`.
- Endpunkt live: `https://visitortax.deskline.net/ProcessData.asmx`. Test: `visitortaxtest.deskline.net` [Doku 2018; Host bestätigt durch 401].
- Nachrichtenteile laut WSDL: `gemeinde`, `companyCode`, `forceImportSettled`, `forceImportCancelled`, `loginID`, `source`, `vtFormXml`, **`checkOnly`**.
  - Nur `gemeinde` und `companyCode` sind in der Doku von 2018 beschrieben.
  - **`checkOnly`** (boolean) deutet auf eine reine Prüfung ohne Speichern hin. Das wäre für Validierung und Abnahme sehr nützlich [offen].
  - Die `force*`-Schalter sind nicht für uns gedacht und werden **nie** gesetzt [offen].
- Antwort: `answer` mit **0..n** `error`-Elementen und optional einer `warnung`. Ein `error` hat die Attribute `betriebnr`, `code` (Pflicht), `guid`, `lfdnr`, `mblattnr` (Pflicht), `oestat` (Pflicht), `text` und `uvmnr`.
  - **Auch ein Erfolg kommt als `error code="0"`.**

### ImportPMSString [WSDL, Doku 2018]

- HTTP-POST mit dem XML im Body, Wurzel `PMSImport` (umschließt `gemeinde` und `companyCode`), `content-type text/xml`.
- Der Eingang ist in der WSDL nicht beschrieben (leerer Body), die Antwort ist dasselbe `answer`.

**Entscheidung:** Wir verwenden **ImportPMS (SOAP 1.1)**, weil es in der WSDL typisiert ist. ImportPMSString bleibt die Rückfalloption, falls feratel das empfiehlt [offen].

## 2. GetVTInfo und GetVTCountryList

- **GetVTInfo** [WSDL] (SOAP oder HTTP-GET). Parameter: `companyCode`, `betriebnr`, `oestat`. Bei fehlender Berechtigung kommt **401** [Doku 2018]. Das Ergebnis enthält je Betrieb:
  - `nummernblocklist`: Blöcke mit `nrjahr`, `nrvon`, `nrbis`, `nextnr`, `status` (0 frei / 1 in Verwendung / 2 verbraucht) und `typ` (Standard `HOTELPROGRAMM`). **`nrjahr` ist neu** [XSD].
  - `gastartlist` mit `AlterTaggenau`: Personengruppen mit `altervon`, `alterbis`, `code`, `name`, `order`. Sie sind die Grundlage für `gastart` bzw. die Taxe.
  - `card`: `link`, `mandant`, `name` und `cardtypes`, falls die Region die feratel-Gästekarte nutzt.
  - `webclient` (`link`, `DBCode`), **`precheckin`** und **`selfcheckin`**: Links, neu gegenüber 2018 [XSD].
  - Laut WSDL möglicherweise auch `meldeblatt`-Elemente. Ob GetVTInfo Meldungen auflisten kann, ist **[offen]**; das wäre die Grundlage für einen Abgleich nach Zeitüberschreitung.
- **GetVTCountryList**: `Services.asmx/GetVTCountryList?CountryCode=AT|DE|CH|LI`. Liefert die statistischen Länder- und Regionsschlüssel (`lschlnr`) [Doku 2018; nicht abgerufen].
  - Empfehlung von feratel: je Gast `nation` (ISO-2) und `plz` senden, das System leitet die Statistik-Nation selbst ab.
  - Trotzdem ist im Meldeblatt **`landschl` Pflicht**, mit `lschlnr` und `anzpers`.
- **PMSAutoAssignVTBlock** [WSDL]: holt den nächsten freien Nummernblock. Das geht nur, wenn mehr als 60 % der zugeteilten Nummern verbraucht sind [Doku 2018].

## 3. XML-Struktur und Pflichtfelder

```
gemeinde oestat* version* (1|2|5)
└ betrieb betriebnr* [betriebnr_alpha]
  └ meldeblatt mblattnr bearbeiter* ankunft* abgeplant reisegruppe* [reservierung] [guid] [abreise] [bemerkung] …
    ├ landschl lschlnr* anzpers*        (≥1; Summe anzpers = Summe gastart.anzpers)
    ├ gastart  gastart* anzpers*        (≥1; Codes aus GetVTInfo)
    └ gast     gastlfdnr* gasttyp vorname name gebdatum nation plz ort strasse staatsang
               reisedokument reisedokumentart geschlecht email telefon zustimmungkartenprod …
companyCode*
```

- **Pflichtfelder laut XSD:**
  - `meldeblatt`: `bearbeiter` (1–50 Zeichen), `ankunft` (Datum), `reisegruppe`.
  - `gast`: `gastlfdnr`.
  - Fast alles andere ist im Schema optional, wird aber fachlich geprüft (Fehlercodes 14, 23, 43, 60–67).
- **Fachlich erforderlich** [Doku 2018]:
  - im Meldeblatt `mblattnr`, `abgeplant` (geplante Abreise) und `reisegruppe`;
  - `landschl` und `gastart` mit übereinstimmender Personenzahl;
  - in **Gästekarten-Regionen** `vorname`, `name` und `gebdatum` je Gast (Fehler 43 bzw. 67);
  - `plz`, wenn Gast **und** Betrieb in AT oder DE liegen (Ableitung der Region).
- **Gästereihenfolge:** `gastlfdnr` ab 1, Reihenfolge **HG → MP → KI**; bei Reisegruppen RL → RG. Gasttypen: `HG` (Hauptgast), `MP` (Mitreisende), `KI` (Kind, Altersgrenze je Gemeinde), `RL`/`RG` (Reiseleitung/Reisegruppe).
- **Felder, die die XSD heute kennt, die Doku von 2018 aber nicht** [offen]:
  - `meldeblatt`: `storno`, `mguid`, `mblattrefnr`, `abgereist`, `signatur` (Liste aus `Keine`, `DokPassScan`, `GastSignatur`), `kontaktverfolgung`, `kfz`, `ankunftszeitvon`, `ankunftszeitbis`, `zahlungsart`, `undef1–3`.
  - `gast`: `gastkartenr`, `gastkarteguid`, `ausweisnr`, `herkunftsland_iso`, `gastID`, `abgabe`, `sprache`, `strasse2`, `abgeplant`.
- **Wertebereiche:**
  - Geschlecht `geschlecht` ∈ {0, 1, 2} (ATSexEnum). **Die Bedeutung ist nicht dokumentiert** [offen].
  - Dokumentart: `Reisepass`, `Personalausweis`, `Fuehrerschein`, `Sonstige` [Doku 2018].
- **Zeichensatz:** Die Beispiele mischen UTF-8 und ISO-8859-1 [offen]. Wir senden UTF-8.

## 4. Voranmeldung und Umwandlung in die verbindliche Meldung

| Schritt                                   | XML                                                      | Antwort                                                                      |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Voranmeldung anlegen                      | `reservierung="1"` `mblattnr="-1"`                       | `code=0`, **`guid`** (merken!)                                               |
| Voranmeldung ändern (nur bis zur Anreise) | `reservierung="1"` `mblattnr="-1"` `guid="…"`            | `code=0`                                                                     |
| Umwandeln in Meldeschein                  | `reservierung="0"` `mblattnr="<neue Nummer>"` `guid="…"` | `code=0`                                                                     |
| Voranmeldung stornieren                   | `reservierung="1"` `guid` mit `ankunft = abreise`        | 2018: **„not working … available soon“**. Heute **[offen]** (evtl. `storno`) |

- Voranmeldungen sind seit v1.0.2 für alle Betriebe erlaubt [Doku 2018].
- Eine Voranmeldung wird laut Doku an das Gästekartensystem weitergereicht und dient dem Schnell-Check-in.

## 5. Meldeschein-Nummernblöcke und eindeutige Referenzen

- **Jede neue Meldung braucht eine neue `mblattnr` aus einem dem Betrieb zugeteilten Block.** Fremde Nummern führen zu Fehler 13 bzw. 29.
- **Stornierte Nummern bleiben belegt** [Doku 2018].
- Die Blöcke kommen aus GetVTInfo (`nextnr`) bzw. PMSAutoAssignVTBlock. Laut aktueller XSD gibt es eine **Jahreszuordnung (`nrjahr`)**. Ob Nummern je Jahr gelten, ist [offen].
- **Folge für uns:** Die Nummer vergeben **wir** vor dem Senden aus dem Block und speichern sie fest (Write-ahead), bevor gesendet wird. Ein erneuter Versuch verwendet dieselbe Nummer. Den Schutz in der Datenbank sichert ein eindeutiger Schlüssel je Objekt, Ziel und Jahr+Nummer (Migration in F3).
- **Referenzen von feratel:** `guid` für die Voranmeldung und `mblattnr` für den Meldeschein. Das sind **zwei** Referenzen, im F2-Modell gibt es nur `external_reference` (write-once). Deshalb kommen eigene write-once-Spalten `pre_registration_guid` und `sheet_number` dazu (F3).
- **Unsere eigene Referenz** (`up-<id>`): Ein Feld dafür ist nicht dokumentiert. In Frage kommen `bemerkung`, `undef1` und `mblattrefnr`; feratel muss das Feld festlegen [offen]. `bemerkung` sieht die Gemeinde. Ohne Freigabe senden wir dort nichts.

## 6. Änderungen, Stornierungen und Abmeldungen

- **Änderungen:** Die **gleiche `mblattnr` erneut zu senden, aktualisiert** den Meldeschein. Das Abnahmetest-Szenario 2.2 zeigt die Verlängerung von `abgeplant` [Doku 2018].
- **Nach dem Status „Angereist“:**
  - eine abweichende Anreise → Fehler 41;
  - abweichende Meldescheindaten → **Fehler 70**;
  - bereits angereist gespeichert → Fehler 16.

  Welche Felder danach noch geändert werden dürfen (`abgeplant`? weitere Mitreisende?), ist [offen].

- **Abmeldung:** `abreise` erst senden, **wenn der Gast abgereist ist**. Danach ist keine Änderung mehr möglich (Fehler 15). Bis dahin `abgeplant` verwenden.
- **Storno:** Senden mit `ankunft = abreise` storniert den Meldeschein, „wenn erlaubt und möglich“.
  - Fehler 69: Die Gästekarte ist schon in Verwendung.
  - Fehler 58: Der Meldeschein ist schon storniert.
  - Fehler 52/53: Der Meldeschein ist abgerechnet bzw. von der Meldebehörde geändert.
- **Abweichende Reisedaten einzelner Gäste:** Die XSD erlaubt `ankunft`/`abreise` je Gast. Laut FAQ Vorarlberg ist das in Österreich aber unzulässig, dort gilt eine eigene Meldung. Wir senden keine abweichenden Daten je Gast.

## 7. Gästekarte und `zustimmungkartenprod`

- **Ablauf:** In Regionen mit feratel-Gästekarte übergibt Deskline die Daten selbst an das Kartensystem [Doku 2018]. Wir rufen kein Kartensystem auf.
- **Voraussetzung:** Nur Gäste mit gültigem Vor- und Nachnamen und Geburtsdatum erhalten eine Karte. Fehlen diese Felder in Kartenregionen, kommt Fehler 43 bzw. 67.
- **`zustimmungkartenprod`** (je Gast, 0/1) ist die DSGVO-Einwilligung, die Daten an das Kartensystem weiterzugeben.
  - Fehlt das Attribut, gilt der Standardwert des Betriebs. Ein späterer Widerruf ginge dann nur über den Webclient.
  - feratel empfiehlt, es **immer zu senden**. Folge für uns: Der Check-in braucht eine **explizite, dokumentierte Einwilligung je Reisendem**; für Minderjährige erteilt sie der Hauptgast.
- **Zustellung:** In Vorarlberg verschickt das System den Kartenlink an die Gast-E-Mail (siehe Recherche F0). Ob dafür `gast.email` des Hauptgasts genügt, ist **[offen]**.
- **Kartenstatus:** ImportPMS liefert keinen Status. GetVTInfo liefert nur einen allgemeinen Systemlink. `PrintGuestCard` ist ein Druck- bzw. Autologin-Link für das Personal, nicht für Gäste.
  - **Folge:** Die Gästekarte bleibt in der App „angefordert“. Einen Kartenlink für den Gast gibt es nicht. Die XSD-Felder `gastkartenr`/`gastkarteguid` deuten auf mehr hin [offen].

## 8. Rückmeldungen, Fehlercodes und Schutz vor Doppelmeldungen

Abbildung auf unser Ergebnismodell (`ProviderOutcome`, ADR 0022):

| Codes                                       | Bedeutung                                                                    | Ergebnis                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0                                           | OK                                                                           | `ok`; Referenz = `guid` (Voranmeldung) bzw. `mblattnr` |
| 1, 3, 4, 5, 6, 59                           | SSL, Content-Type, XML, gemeinde/version                                     | `rejected` (Fehler bei uns, Ticket)                    |
| 2                                           | Login fehlerhaft                                                             | `rejected` `auth`                                      |
| 7, 8, 9, 10, 57, 68                         | Gemeinde, Betrieb oder Kartenkennung unbekannt bzw. inaktiv                  | `rejected` `not_configured`                            |
| 11, 12, 13, 29                              | Meldeschein fehlt bzw. Nummer nicht zugeteilt                                | `rejected` `conflict` (Nummernblock prüfen)            |
| 14, 21–27, 31–40, 42, 43, 45, 55, 56, 60–67 | Datenfehler                                                                  | `rejected` `invalid_data`                              |
| 15, 16, 41, 52, 53, 70                      | Meldeschein abgereist, angereist, abgerechnet oder von der Gemeinde geändert | Übergabe an das Team (`registration-immutable`)        |
| 47, 48, 49                                  | Voranmeldung (guid) nicht speicher-, änder- oder auffindbar                  | Übergabe an das Team                                   |
| 58                                          | bereits storniert                                                            | `ok` beim Storno, sonst `conflict`                     |
| 69                                          | Storno unmöglich, Gästekarte in Verwendung                                   | Übergabe an das Team                                   |
| 18                                          | interner Fehler beim Speichern                                               | `temporary`                                            |
| 99                                          | allgemeiner Fehler                                                           | `temporary`, nach wenigen Versuchen `failed`           |
| HTTP 401                                    | Berechtigung                                                                 | `rejected` `auth`                                      |
| HTTP 5xx, Timeout, Netz                     | –                                                                            | `temporary` bzw. `ambiguous` (siehe unten)             |

**Doppelmeldungen:**

- Die Antwort kann **mehrere** `error`-Elemente enthalten (Bulk). Wir senden genau **ein** Meldeblatt pro Aufruf und werten nur dieses aus. Eine `warnung` wird protokolliert, ohne Text, nur als Kennzeichen.
- **Meldeschein mit eigener `mblattnr`:** Ein erneutes Senden ist laut Doku ein Update. Nach einer Zeitüberschreitung wird **dieselbe Nummer mit identischen Daten** erneut gesendet; dabei entsteht keine zweite Meldung.
  - Wie die Antwort lautet, wenn die erste Sendung schon gespeichert war (0, 16 oder 70), ist [offen]. Bis zur Klärung führt 16/70 nach einem unklaren Versuch zur Übergabe an das Team.
- **Voranmeldung** (`mblattnr="-1"`): Die `guid` kommt erst in der Antwort. Bei Zeitüberschreitung droht eine **doppelte Voranmeldung**, und eine Abfrage nach unserer Referenz ist nicht dokumentiert.
  - Deshalb bleibt `lookup-by-reference` **aus**, ein unklarer Ausgang geht an das Team (vorhandene Logik).
  - Zu klären ist, ob wir eine eigene `guid`/`mguid` mitsenden dürfen [offen].
- Der Fingerprint, die Zustandstabelle und die eindeutige `sheet_number` (F3) verhindern doppelte Meldungen auf unserer Seite.

## 9. Authentifizierung und betriebsbezogenes Mapping

- **`companyCode`** [WSDL/Doku] identifiziert den **Softwarehersteller**, hier UNIQUE PLACES, nicht den Betrieb. Er ist geheim: nur als Server-Secret, nie in der Datenbank oder in Logs.
- **`oestat`** ist die Meldebehörden-Nummer der Gemeinde, **`betriebnr`** bzw. `betriebnr_alpha` die des Betriebs („Mapping“). Beides vergibt bzw. trägt feratel ein (meldewesen@feratel.at).
  - Beide Werte sind **nicht geheim** und gehören in `provider_settings` je Objekt.
- **Ablauf der Freischaltung** [Doku 2018]:
  1. Die Schnittstelle wird für unsere Firma aktiviert.
  2. feratel trägt das Mapping je Betrieb ein.
  3. Wir bekommen eine Testumgebung.
  4. Wir führen den **Abnahmetest** mit 7 Szenarien durch.
  5. feratel prüft die Daten und gibt danach die **Live-Zugangsdaten** frei.
- Die direkten Kunden von feratel sind die **Destinationen**, nicht die Betriebe.

## 10. Anforderungen an unseren Online-Check-in

| Bedarf                                                          | Heute                                                   | Maßnahme (F3)                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `vorname`, `name`, `gebdatum` für **alle** Gäste (Kartenregion) | Begleitpersonen: Geburtsdatum nur je nach Konfiguration | Vorlage AT bzw. Kartenregion: Pflicht für alle                                                                           |
| `nation` (Wohnsitzland) und `plz` je Gast; `staatsang`          | Adresse nur beim Hauptgast; Nationalität vorhanden      | Wohnsitzland und PLZ je Gast (Option „wie Hauptgast“ ist vorhanden)                                                      |
| `gasttyp` HG/MP/KI, `gastart`-Code                              | HG/MP über Position, Kind über Alter                    | KI und `gastart` aus der GetVTInfo-`gastartlist` (Altersgrenzen, `AlterTaggenau`)                                        |
| `landschl` (Länderschlüssel)                                    | –                                                       | Abbildung ISO → `lschlnr` über GetVTCountryList (zwischengespeichert), Summen prüfen                                     |
| `geschlecht`                                                    | fehlt                                                   | Erst nach Klärung der Werte 0/1/2 und der Pflicht; sonst nicht erheben                                                   |
| `reisedokumentart`/`reisedokument`                              | passport, id-card, other                                | Abbildung auf Reisepass, Personalausweis, Sonstige; Führerschein ergänzen                                                |
| `zustimmungkartenprod` je Gast                                  | fehlt                                                   | **Einwilligung** je Reisendem (Hauptgast für Minderjährige), getrennt protokolliert                                      |
| `email` (Kartenzustellung)                                      | bestätigte E-Mail des Hauptgasts                        | nur beim Hauptgast, nur bestätigt                                                                                        |
| `signatur` (AT, ausländische Gäste)                             | fehlt                                                   | rechtlich offen: Ersetzt der Online-Check-in die Unterschrift? Sonst Unterschrift vor Ort bzw. Self-Check-in von feratel |
| `abgeplant`, `abreise`                                          | Apaleo-Daten                                            | `abgeplant` = geplante Abreise; `abreise` erst nach der tatsächlichen Abreise                                            |
| `bearbeiter`                                                    | –                                                       | fester Produktname „UNIQUE PLACES Guest App“                                                                             |

---

## Abgleich mit der F1/F2-Architektur

| ADR-0022-Operation        | Abbildung in ImportPMS                   | Fähigkeit                                      |
| ------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `create-pre-registration` | `reservierung=1`, `mblattnr=-1` → `guid` | dokumentiert (2018), unklarer Ausgang ⇒ Team   |
| `update-pre-registration` | `reservierung=1` + `guid`                | dokumentiert (2018)                            |
| `delete-pre-registration` | 2018 nicht verfügbar                     | **aus** bis zur Bestätigung                    |
| `create-registration`     | `reservierung=0` + eigene `mblattnr`     | dokumentiert, erneutes Senden = Update         |
| `convert-to-registration` | `reservierung=0` + `mblattnr` + `guid`   | dokumentiert (2018)                            |
| `update-departure`        | gleiche `mblattnr`, neues `abgeplant`    | dokumentiert für „vor der Abreise“             |
| `check-out`               | gleiche `mblattnr` + `abreise`           | dokumentiert                                   |
| `cancel-registration`     | `ankunft = abreise`                      | dokumentiert, mit Einschränkungen (69, 52, 53) |
| `lookup-by-reference`     | nicht dokumentiert                       | **aus**                                        |

- **Passt bereits:**
  - Zustandsmodell, Gate, getrennter Gästekartenstatus;
  - Übergabe an das Team bei nicht unterstützten Operationen;
  - unklare Anlagen werden nicht wiederholt;
  - konfigurierbarer Zeitpunkt der verbindlichen Meldung;
  - `allowed_operations` je Standort, Protokoll.
- **Muss angepasst werden** (F3/F4):
  1. **Zwei Referenzen:** `pre_registration_guid` und `sheet_number` (+ Jahr), beide write-once und eindeutig. Dazu eine **Nummernvergabe aus Blöcken** (Write-ahead).
  2. Eine **Rückweisung nach dem Status „Angereist“** (16, 41, 70) geht an das Team, mit eigenem Grund `rejected-after-arrival`.
  3. `update-departure` gilt nur bis zur tatsächlichen Abreise. `check-out` ist endgültig (15).
  4. Für die Gästekarte wird die Einwilligung je Gast benötigt. Ohne Einwilligung wird für diesen Gast `zustimmungkartenprod=0` gesendet und es gibt keine Karte.
  5. `FERATEL_DOCUMENTED_CAPABILITIES` werden erst **nach der Bestätigung durch feratel** und bestandenem Abnahmetest in der Testumgebung gesetzt, ausdrücklich nicht auf Basis der Doku von 2018.
