# Feratel-Gästemeldung – Architektur und offene Anforderungen

Stand: Phase 11. **Keine Feratel-Integration implementiert, keine Aufrufe.** Architektur: [ADR 0016](../adr/0016-guest-journey-and-online-check-in.md).

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
