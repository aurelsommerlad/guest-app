# Anfrage an feratel: Deskline 3.0 VT PMS Web Services (ImportPMS)

> **Version 2 (2026-11-05)**: überarbeitet nach Analyse der öffentlichen Doku v1.0.4 (2018), des Abnahmetests und der aktuellen WSDL/XSD (siehe [Analyse](feratel-vt-pms-web-services-analyse.md)). Ersetzt den Entwurf aus F0.
>
> - Platzhalter in `[eckigen Klammern]` vor dem Versand ausfüllen.
> - Den `companyCode` und alle Zugangsdaten **nicht per E-Mail** zurücksenden lassen, sondern über einen sicheren Kanal.
> - **Empfänger:** meldewesen@feratel.at (feratel media technologies AG, Villach). In Kopie: die zuständigen Stellen der drei Standorte.

---

**Betreff:** Aktivierung VT PMS Web Services (ImportPMS) für eigene Software, Testumgebung und Mapping – ΛLPILΛ (Gaschurn), HŪSLE (Bludenz), LÆKE (Lindau)

Sehr geehrte Damen und Herren,

wir betreiben unter der Marke UNIQUE PLACES Ferienapartments. Als PMS nutzen wir Apaleo. Für unsere Gäste haben wir eine **eigene Gäste-App mit Online-Check-in** entwickelt. Aus dieser Anwendung möchten wir die Meldedaten **direkt** über die **Deskline 3.0 VT PMS Web Services** (Methode `ImportPMS`) übermitteln. Es gibt keinen Drittanbieter dazwischen.

Betroffen sind diese Betriebe:

- **ΛLPILΛ** – Gaschurn (Montafon)
- **HŪSLE** – Bludenz (Alpenregion Bludenz)
- **LÆKE** – Lindau (Bodensee), falls Lindau über Deskline meldet

Die öffentlich verfügbare Dokumentation v1.0.4 (11/2018), den Abnahmetest v1 und Ihre aktuelle WSDL/XSD unter `visitortax.deskline.net` haben wir ausgewertet. Unsere Umsetzung bilden wir bereits daran ab, bisher ausschließlich mit simulierten Antworten. **Es wurden und werden keine Daten an Ihre Systeme gesendet, bevor Sie uns freischalten.**

### A. Aktivierung, Testumgebung, Abnahme

1. Bitte aktivieren Sie die Schnittstelle für unsere Firma und teilen Sie uns einen **`companyCode` für die Testumgebung** mit.
2. Bitte richten Sie uns einen Zugang zur **Testumgebung** ein (`visitortaxtest.deskline.net`, derzeit HTTP 401). Dazu brauchen wir je Standort Test-Werte für `oestat` und `betriebnr` sowie Test-Nummernblöcke.
3. Bitte senden Sie uns die **aktuelle Dokumentation** (wir kennen eine v1.0.6 vom 25.03.2019, aber nur dem Titel nach) und die **aktuelle Version des Abnahmetests** mit den Änderungen seit 2018.
4. Wie läuft die Abnahme ab, welche Dauer ist realistisch, und fallen **Kosten** an (Schnittstelle, Abnahme, Betrieb, Gästekarte)?
5. Gibt es für eine eigene Gäste-App (kein klassisches Hotelprogramm) Besonderheiten bei der Freigabe?

### B. Mapping je Betrieb

6. Bitte tragen Sie das Mapping für die drei Betriebe ein, bzw. teilen Sie uns mit, welche Angaben Sie benötigen (Name, Anschrift, Kontakt). Wir brauchen jeweils `oestat`, `betriebnr` bzw. `betriebnr_alpha`, die Test- und Live-Werte getrennt.
7. **Nummernblöcke:**
   - Gelten Meldescheinnummern je Kalenderjahr (`nrjahr` in der XSD)?
   - Dürfen wir `PMSAutoAssignVTBlock` automatisiert verwenden, sobald mehr als 60 % verbraucht sind?
   - Gilt `typ="HOTELPROGRAMM"` auch für uns?
8. Wir würden die Nummern **selbst aus dem zugeteilten Block** vergeben (`nextnr` aus `GetVTInfo`) und vor dem Senden fest speichern. Entspricht das Ihrer Empfehlung?

### C. Abläufe (bitte jeweils bestätigen oder korrigieren)

9. **Voranmeldung:**
   - Anlegen mit `reservierung="1"`, `mblattnr="-1"`; die Antwort enthält eine `guid`.
   - Ändern bis zur Anreise mit `guid`.
   - Umwandeln mit `reservierung="0"` + `mblattnr` + `guid`.
   - Löst eine Voranmeldung mit Gast-E-Mail bereits die digitale Gästekarte aus?
10. **Storno einer Voranmeldung:** Der Abnahmetest (2018) sagt „not working in the current version“. Wie geht das heute? Ist dafür das Attribut `storno` vorgesehen?
11. **Änderungen** am Meldeschein (gleiche `mblattnr`) vor der Abreise:
    - Welche Felder sind nach dem Status „Angereist“ noch änderbar (`abgeplant`, Mitreisende hinzufügen oder entfernen)?
    - Ab wann gilt ein Meldeschein als „Angereist“?
12. **Abmeldung:** `abreise` erst nach der tatsächlichen Abreise senden, danach sind keine Änderungen mehr möglich. Korrekt?
13. **Storno** eines Meldescheins über `ankunft = abreise`:
    - Bis wann ist das möglich (Codes 52, 53, 69)?
    - Wird bei einem Storno auch die Gästekarte deaktiviert?
14. **Zeitüberschreitung und Wiederholung:**
    - Welche Antwort kommt, wenn wir nach einem Timeout dieselbe `mblattnr` mit identischen Daten erneut senden und die erste Sendung bereits gespeichert war (0, 16 oder 70)?
    - Wie vermeiden wir **doppelte Voranmeldungen**, wenn die Antwort mit der `guid` verloren geht? Dürfen wir eine eigene `guid`/`mguid` mitsenden, oder lassen sich Meldungen abfragen, etwa über `GetVTInfo`?
15. **Eigene Referenz:** In welchem Feld dürfen wir eine eigene, nicht personenbezogene Referenz je Meldung mitgeben (`mblattrefnr`, `undef1`, `bemerkung`)?
16. Bedeutung und Verwendung der WSDL-Teile `checkOnly`, `loginID`, `source`, `vtFormXml`, `forceImportSettled` und `forceImportCancelled`:
    - Ist `checkOnly` eine reine Prüfung ohne Speichern?
    - Wir gehen davon aus, dass wir die `force*`-Schalter nicht setzen.
17. **ImportPMS (SOAP 1.1)** oder **ImportPMSString (POST)**: Was empfehlen Sie? Welcher Zeichensatz gilt (UTF-8)?

### D. Felder und Codelisten

18. Bitte die Bedeutung der neueren XSD-Attribute:
    - Meldeblatt: `signatur` (`Keine` / `DokPassScan` / `GastSignatur`), `kontaktverfolgung`, `kfz`, `ankunftszeitvon`/`ankunftszeitbis`, `abgereist`, `mguid`, `mblattrefnr`.
    - Gast: `gastkartenr`, `gastkarteguid`, `ausweisnr`, `herkunftsland_iso`, `gastID`, `sprache`.
19. Bitte die **Werte von `geschlecht`** (0/1/2): Ist das Feld in Vorarlberg bzw. Bayern Pflicht?
20. `landschl`:
    - Genügen `nation` + `plz` je Gast, oder müssen wir `lschlnr` aus `GetVTCountryList` senden?
    - Welcher Wert gilt für Gäste außerhalb von AT, DE, CH und LI?
21. `gastart`: Gilt die `gastartlist` aus `GetVTInfo` (mit `AlterTaggenau`) als verbindliche Quelle für Personengruppen und das Kinderalter je Gemeinde?
22. **Ausländische Gäste in Österreich:**
    - Genügt der Online-Check-in mit `signatur` als Ersatz für die Unterschrift auf dem Gästeblatt?
    - Oder ist am Anreisetag eine Unterschrift bzw. ein Ausweis-Scan nötig, etwa über Ihren Self-Check-in?

### E. Digitale Gästekarte

23. Wird die Gästekarte in den Regionen Montafon und Brandnertal/Bludenz/Klostertal bei Meldung über ImportPMS **automatisch erzeugt und an `gast.email` versendet**?
    - Genügt die E-Mail des Hauptgasts für alle Karten des Meldescheins?
    - Ab wann vor der Anreise wird versendet?
24. `zustimmungkartenprod`:
    - Wir senden es je Gast mit 1 oder 0, je nach dokumentierter Einwilligung im Check-in. Für Minderjährige willigt der Hauptgast ein. Ist das so korrekt?
    - Was geschieht bei 0?
25. Liefert die Schnittstelle einen **Kartenstatus** oder einen Karten-Link, den wir dem Gast in unserer App anzeigen dürfen? Oder ist der Versand ausschließlich Ihre Aufgabe?
26. **Lindau:** Meldet die Stadt Lindau über Deskline? Falls ja: Wie läuft die ECHT BODENSEE CARD über ImportPMS (Lindau tritt der neuen EBC laut FAQ 2026 später bei)?

### F. Betrieb und Datenschutz

27. Ratenlimits, IP-Freigaben, TLS-Anforderungen, Wartungsfenster; Ansprechpartner bei Störungen.
28. Ihre Rolle nach DSGVO (Auftragsverarbeiter von Betrieb oder Gemeinde), die AVV-Unterlagen, der Speicherort und die Löschfristen.

**Zu unserer Umsetzung:**

- Zugangsdaten (`companyCode`) liegen ausschließlich serverseitig.
- Übertragen werden nur die für die Meldung bzw. Gästekarte erforderlichen Felder.
- Jede Meldung läuft über eine eigene Nummer aus Ihrem Block, mit Wiederholungsschutz und Protokoll.
- Produktive Meldungen gibt es erst nach Ihrer Abnahme.

Für eine kurze Abstimmung stehen wir gern zur Verfügung.

Mit freundlichen Grüßen

[Name]
[Funktion]
UNIQUE PLACES · [Firma/Rechtsträger]
[Anschrift]
[Telefon] · [E-Mail]

---

## Begleitanfragen an die Standorte (Kurzfassung)

feratel trägt das Mapping ein. Die Gemeinden bzw. Tourismusverbände kennen aber `oestat`, `betriebnr`, Nummernblöcke, Personengruppen und den Kartenprozess.

### ΛLPILΛ – Gaschurn / Montafon

An: Montafon Tourismus GmbH (info@montafon.at, +43 50 6686) bzw. Gemeinde Gaschurn (Meldewesen)

1. Bitte bestätigen Sie unsere `oestat` und `betriebnr` und die zugeteilten Meldeschein-Nummernblöcke, und unterstützen Sie das Mapping bei feratel für unsere eigene Software.
2. Welche Personengruppen (`gastart`), Altersgrenzen und Befreiungen gelten?
3. **Gästekarte:** Entfällt unser bisher manueller Versand, wenn die Meldung mit E-Mail des Hauptgasts und Einwilligung (`zustimmungkartenprod`) über ImportPMS kommt?
4. Welche Fristen gelten für Meldeschein und Abmeldung, und wie laufen Korrekturen nach dem Status „Angereist“?

### HŪSLE – Bludenz

An: Alpenregion Bludenz Tourismus GmbH (Mutterstraße 1a, 6700 Bludenz) bzw. Stadt Bludenz (Meldewesen)

1. bis 4. wie oben.
2. Wird die Gästekarte Brandnertal/Bludenz/Klostertal digital (feratel-E-Mail bzw. Web-App) bereitgestellt oder nur durch den Gastgeber ausgegeben? Gilt für uns die Premium-Variante?

### LÆKE – Lindau

An: Stadt Lindau, Steuerabteilung (Kurbeitrag/Meldewesen), kurbeitrag@lindau.de, +49 8382 918226

1. Meldet Lindau über **feratel Deskline** (VT PMS Web Services / ImportPMS) oder über **AVS**?
2. Falls Deskline: Bitte nennen Sie `oestat`, `betriebnr` und die Nummernblöcke und unterstützen Sie die Freischaltung bei feratel. Falls AVS: Bitte nennen Sie die Schnittstelle und den Ansprechpartner.
3. Welche Kurbeitrag-Kategorien (ab 16 Jahren) und Befreiungen gelten, und welche Fristen (Meldeschein etwa zwei Wochen vor Anreise)?
4. Wie wird die **ECHT BODENSEE CARD** digital bereitgestellt, und wann stellt Lindau auf die neue EBC (VDV-Code) um?
5. Welche Pflichten bestehen beim BMG-Meldeschein ausländischer Gäste (Unterschrift, Aufbewahrung) bei elektronischer Meldung?
