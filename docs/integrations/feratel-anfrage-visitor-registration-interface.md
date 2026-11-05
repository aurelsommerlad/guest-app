# Anfrage an feratel: Visitor Registration Interface (Deskline 3.0)

> Versandfertiger Entwurf (F0, ADR 0022). Platzhalter in `[eckigen Klammern]` vor dem Versand ausfüllen. Keine Zugangsdaten per E-Mail zurücksenden lassen – nur über einen sicheren Kanal.
>
> Empfänger: feratel media technologies AG, Schnittstellen- bzw. Partnerteam Deskline (Kontakt über die Gemeinden bzw. Tourismusorganisationen oder über feratel.com erfragen). In Kopie die zuständigen Stellen der drei Standorte.

---

**Betreff:** Anbindung eines eigenen Online-Check-ins an das Visitor Registration Interface (Deskline 3.0): Dokumentation, Testzugang, Mapping-Codes – ΛLPILΛ (Gaschurn), HŪSLE (Bludenz), LÆKE (Lindau)

Sehr geehrte Damen und Herren,

wir betreiben unter der Marke UNIQUE PLACES Ferienapartments in Vorarlberg und am Bodensee:

- **ΛLPILΛ** in Gaschurn (Montafon)
- **HŪSLE** in Bludenz (Alpenregion Bludenz)
- **LÆKE** in Lindau (Bodensee)

Als PMS setzen wir Apaleo ein. Für unsere Gäste haben wir eine eigene Gäste-App mit Online-Check-in entwickelt. Darin erfassen die Gäste ihre Meldedaten und die ihrer Mitreisenden vor der Anreise.

Diese Meldedaten möchten wir **direkt aus unserer Anwendung** elektronisch an das feratel-Meldewesen übermitteln. Den Gästen sollen dabei die digitalen Gästekarten der jeweiligen Destination automatisch bereitgestellt werden. Ziel ist eine vollständig automatisierte, rechtskonforme Gästemeldung ohne doppelte Erfassung.

Nach unseren Informationen ist dafür das **Visitor Registration Interface (Deskline 3.0)** vorgesehen. Für Planung und Umsetzung bitten wir um folgende Informationen und Zugänge.

### 1. Dokumentation

1. Die aktuelle, offizielle Schnittstellendokumentation des Visitor Registration Interface: Version, technische Beschreibung (z. B. WSDL/XSD bzw. API-Spezifikation), Endpunkte je Umgebung, Beispielnachrichten.
2. Feldbeschreibungen und Codelisten, insbesondere:
   - Staatsangehörigkeiten;
   - Dokumentarten;
   - Geschlecht bzw. Anrede;
   - Gästekategorien und Gästetaxe-Kategorien (pflichtig/frei);
   - Altersstufen von Kindern;
   - Reisegruppen.
3. Pflichtfelder je Meldeart sowie Unterschiede zwischen Österreich (Vorarlberg) und Deutschland (Bayern).
4. Das Fehlermodell (Validierungsfehler vs. temporäre Fehler), Ratenlimits und das empfohlene Verhalten bei Zeitüberschreitungen.

### 2. Zugang, Freigabe und Kosten

5. Den Ablauf, um als **eigener Softwareanbieter bzw. Integrationspartner** freigeschaltet zu werden: Registrierung, Abnahme bzw. Zertifizierung, Testfälle, Dauer.
6. Ob für eine selbst entwickelte Gäste-App mit Apaleo als PMS (kein klassisches Hotelprogramm) Besonderheiten gelten.
7. Die Authentifizierung: Partnerzugang, Zugangsdaten je Betrieb, Gemeinde oder Destination?
8. Die Rolle der **Mapping-Codes**: Wer vergibt sie (Gemeinde, Tourismusorganisation), wie werden sie je Betrieb eingesetzt, und gibt es getrennte Codes für Test und Produktion?
9. Einen **Testzugang bzw. eine Testumgebung**, möglichst für Vorarlberg und, falls zutreffend, für Lindau. Wir übertragen keine Daten an eine produktive Umgebung, bevor die Abnahme erfolgt ist.
10. Mögliche **Kosten** für Schnittstelle, Abnahme, Betrieb oder Gästekarten, und wer sie trägt (Betrieb, Softwareanbieter, Destination).

### 3. Fachliche Abläufe, die wir abbilden möchten

Bitte teilen Sie uns mit, welche der folgenden Vorgänge die Schnittstelle unterstützt und wie:

11. **Voranmeldung:**
    - Anlegen, Ändern und Löschen vor der Anreise (noch ohne Übermittlung an die Gemeinde).
    - Löst eine Voranmeldung mit Gast-E-Mail bereits die digitale Gästekarte aus?
12. **Verbindlicher Meldeschein:**
    - Anlegen direkt oder durch Umwandlung einer Voranmeldung.
    - Ab wann ist er nicht mehr änderbar?
13. **Änderungen:**
    - Verlängerung oder Verkürzung des Aufenthalts.
    - Hinzufügen oder Entfernen von Mitreisenden.
    - Abweichende Reisedaten einzelner Mitreisender.
14. **Abmeldung** mit dem tatsächlichen Abreisedatum.
15. **Stornierung** vor der Anreise sowie Storno bzw. Korrektur eines bereits verbindlichen Meldescheins.
16. **Eigene Referenz und Abfrage:**
    - Können wir eine eigene, nicht personenbezogene Referenz je Meldung mitgeben?
    - Können wir eine Meldung anhand dieser Referenz abfragen? Das ist wichtig, um nach Zeitüberschreitungen keine Doppelmeldungen zu erzeugen.
17. Welche **Rückgabewerte** liefert die Schnittstelle (z. B. Melde-ID, Status, Bestätigung)?
18. Der Umgang mit **Pre-Check-in und Self-Check-in** von feratel: Wie vermeiden wir Überschneidungen mit unserem eigenen Online-Check-in? Wie läuft die Unterschrift bzw. Ausweisprüfung bei ausländischen Gästen in Österreich?

### 4. Digitale Gästekarten

19. Werden digitale Gästekarten bei Meldungen über die Schnittstelle **automatisch erzeugt und an die hinterlegte Gast-E-Mail versendet**? Ab welchem Zeitpunkt vor der Anreise (z. B. 14 Tage in Vorarlberg)? Bitte für die Montafon-Gästekarte (Gaschurn), die Gästekarte Brandnertal/Bludenz/Klostertal (Bludenz) und die ECHT BODENSEE CARD (Lindau).
20. Liefert die Schnittstelle einen **Status der Gästekarte** zurück (erzeugt, versendet, aktiviert) und/oder einen Link bzw. Code?
21. Dürfen wir die Gästekarte bzw. einen Kartenlink selbst in unserer App anzeigen oder an den Gast senden? Falls ja: über welche Schnittstelle, und unter welchen Bedingungen (VMOBIL- bzw. VDV-Tickets)?
22. Wie werden Gästekarten für Kinder und für Gäste ohne E-Mail-Adresse bereitgestellt?

### 5. Datenschutz

23. Ihre Rolle im Sinne der DSGVO (Auftragsverarbeiter des Betriebs bzw. der Gemeinde?), die AVV-Unterlagen und den Speicherort der Daten.
24. Aufbewahrungs- und Löschfristen im Meldesystem sowie die Vorgaben, welche Daten wir nach der Übermittlung selbst noch speichern dürfen bzw. müssen.

### Zu unserer Umsetzung

- Die Anbindung entwickeln wir selbst (direkte Anbindung, kein Drittanbieter).
- Bis zur Freigabe durch Sie arbeiten wir ausschließlich mit **simulierten Antworten**. Es werden keine produktiven Meldungen übertragen.
- Zugangsdaten werden ausschließlich serverseitig gespeichert.
- Wir übertragen nur die für die Meldung erforderlichen Daten. Kontaktdaten beschränken sich auf die bestätigte E-Mail-Adresse des Hauptgasts für die Gästekarte.

Für eine kurze Abstimmung (Telefon oder Video) stehen wir gern zur Verfügung.

Mit freundlichen Grüßen

[Name]
[Funktion]
UNIQUE PLACES · [Firma/Rechtsträger]
[Anschrift]
[Telefon] · [E-Mail]

---

## Begleitanfragen an die Standorte (Kurzfassung)

Die Gemeinden bzw. Tourismusorganisationen vergeben Mapping-Codes und Zugänge. Die folgenden Kurzanfragen gehen parallel raus, jeweils mit Verweis auf die Anfrage an feratel.

### ΛLPILΛ – Gaschurn / Montafon

An: Montafon Tourismus GmbH (info@montafon.at, +43 50 6686) bzw. Gemeinde Gaschurn (Meldewesen)

1. Wer ist für Meldewesen, Mapping-Code und Webclient-Zugang unseres Betriebs zuständig?
2. Bitte um den Mapping-Code für die Anbindung unserer eigenen Software (Test und Produktion).
3. Welche Gästetaxe-Kategorien, Altersgrenzen für Kinder und Befreiungen gelten?
4. **Gästekarte:** Entfällt unser bisher manueller Versand, wenn die Meldung mit E-Mail des Hauptgasts über die Schnittstelle kommt? Wann versendet feratel die Montafon-Gästekarte?
5. Welche Fristen gelten für Meldeschein und Abmeldung, und wie laufen Korrekturen?

### HŪSLE – Bludenz

An: Alpenregion Bludenz Tourismus GmbH (Mutterstraße 1a, 6700 Bludenz) bzw. Stadt Bludenz (Meldewesen)

1. bis 3. und 5. wie oben.
2. **Gästekarte Brandnertal/Bludenz/Klostertal:** Wird sie digital per feratel-E-Mail bereitgestellt (z. B. über die Web-App) oder nur durch den Gastgeber ausgegeben? Gilt für uns die Premium-Variante?

### LÆKE – Lindau

An: Stadt Lindau, Steuerabteilung (Kurbeitrag/Meldewesen), kurbeitrag@lindau.de, +49 8382 918226

1. Welches elektronische Meldescheinsystem nutzt Lindau: **feratel Deskline oder AVS**?
2. Wie können Hotelprogramme bzw. eigene Software angebunden werden? Gemeint ist die 2019 angekündigte Schnittstelle der Stadt.
3. Welche Kurbeitrag-Kategorien gelten (ab 16 Jahren), welche Befreiungen, und welche Fristen (Meldeschein etwa zwei Wochen vor Anreise)?
4. **ECHT BODENSEE CARD:** Wie wird die digitale Karte bereitgestellt? Wann tritt Lindau der neuen EBC mit VDV-Code bei?
5. Welche Pflichten haben wir beim BMG-Meldeschein ausländischer Gäste (Unterschrift, Aufbewahrung) bei elektronischer Meldung?
