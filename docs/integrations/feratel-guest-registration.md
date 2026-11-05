# Feratel-Gästemeldung – Architektur und offene Anforderungen

Stand: 2026-11-05 (F0/F1, [ADR 0022](../adr/0022-feratel-official-registration.md)). **Keine Aufrufe an feratel.** Eigene Meldelogik und ein eigener Adapter existieren, laufen aber nur gegen eine Simulation. Die dokumentierten Fähigkeiten des echten Interfaces sind leer, bis die offizielle Dokumentation vorliegt. Die versandfertige Anfrage steht in [feratel-anfrage-visitor-registration-interface.md](feratel-anfrage-visitor-registration-interface.md). Die ursprüngliche Architektur beschreibt [ADR 0016](../adr/0016-guest-journey-and-online-check-in.md).

## Recherche 2026-11 (öffentliche Quellen, belegt)

- Vorarlberg (Bodensee-Vorarlberg Tourismus, FAQ Meldewesen 2025):
  - Mit Hotelsoftware schickt der Betrieb den von der Gemeinde vergebenen „Mapping Code“ an den Softwareanbieter; ohne Hotelsoftware nutzt er den Webclient.
  - Voranmeldung = änderbar und löschbar, noch nicht an die Gemeinde übermittelt. Meldeschein = verbindlich, „nicht mehr änderbar“.
  - Alle Gäste einer Meldung haben dieselben Reisedaten.
  - Wird keine Abreise eingetragen, läuft die Gästetaxe weiter.
  - Gästekarte nur für pflichtige Gäste und Kinder.
- Digitale Gästekarte (Bodensee-Vorarlberg): Mit Gast-E-Mail in Voranmeldung oder Meldeschein wird der Link automatisch versendet, 14 Tage vor Anreise oder innerhalb von 10 Minuten. Das gilt auch bei Anbindung über Hotelsoftware.
- Montafon: Die digitale Gästekarte kommt per E-Mail von feratel, nachdem der Aufenthalt gemeldet ist.
- Bludenz: Die Alpenregion nutzt feratel und ein flächendeckendes elektronisches Meldewesen.
- Lindau:
  - Elektronischer Meldeschein seit der Kurbeitragssatzung 2020; Gästekarte ist die ECHT BODENSEE CARD. Kontakt: kurbeitrag@lindau.de.
  - In der EBC-Region laufen feratel **und** AVS; welches System Lindau nutzt, ist offen.
  - Lindau tritt der neuen EBC (VDV-Code) erst später bei.

## Was öffentlich sichtbar ist (nicht verifiziert)

Die offiziellen Dokumente (interfaces.deskline.net, „Documentation Deskline 3.0 VT PMS Web Services“, WSDL unter visitortax.deskline.net) waren aus der Entwicklungsumgebung **nicht erreichbar**. Aus Suchergebnissen/Pressetexten von feratel und Drittanbietern:

- „Visitor Registration Interface“: Meldescheine aus einem PMS direkt in Deskline einspielen; Web-Services auch zum Drucken von Meldescheinen und Gästekarten.
- Technik laut Suchergebnissen: XML-Web-Services (SOAP 1.1/1.2 bzw. HTTP POST), Import-Operation für Meldescheine (genannt: `ImportPMS`, `ImportPMSString`); feratel nennt OTA als Schnittstellenstandard.
- Zugang und Konfiguration laufen über die jeweilige Destination/Gemeinde (Meldewesen pro Gemeinde/Tourismusverband).

Diese Punkte sind **keine** Implementierungsgrundlage.

## Umgesetzt

- Kanonisches Modell und Sync-Zeile `feratel` (Status `pending`, sichtbar, nichts geht verloren).
- `FeratelRegistrationProvider` (Skelett): `implemented = false`, `submit` sendet nichts und meldet `not_configured`. Der Worker ruft ihn nicht auf, solange er nicht implementiert ist.
- `providerSettings.feratel` je Objekt für nicht geheime Werte (z. B. Destination). Zugangsdaten nur als Server-Secret.

## Benötigt von feratel / Destination (vor jeder Implementierung)

1. Offizielle Schnittstellendokumentation (Version, Endpunkte je Umgebung, WSDL/Schema).
2. Authentifizierung: pro Gastgeber, pro Gemeinde/Destination oder pro Integrationspartner? Credentials je Objekt (HŪSLE: Bludenz, ΛLPILΛ: Gaschurn).
3. **Bestätigte Testumgebung** mit Testzugang – vorher werden keine Daten aus Staging gesendet.
4. Meldeschein-Struktur: Pflichtfelder Hauptgast/Mitreisende, Staatsangehörigkeit, Geburtsdatum, Adresse, Ausweisdaten (ob nötig), Gästekategorien (Kurtaxe/Befreiungen).
5. Anlegen / Ändern / Stornieren und die Referenz für spätere Änderungen.
6. Gästekarte: Ausstellung, Zustellung, Rückgabewerte.
7. Fehlermodell (Validierung vs. temporär) für die Abbildung auf `SyncErrorCode`.
8. Ob Apaleo selbst bereits eine Feratel-Anbindung für die Objekte nutzt (Doppelmeldungen vermeiden).
