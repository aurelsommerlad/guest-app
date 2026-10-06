# 0017 – Provider-neutraler Zugang (Access)

**Status:** Akzeptiert (2026-10-06, Phase 11). Ergänzt [ADR 0003](0003-provider-integrations.md) und [ADR 0016](0016-guest-journey-and-online-check-in.md).

## Kontext

Objekte nutzen unterschiedliche Zugangssysteme: Smart Locks (Nuki, DOM, TESA, Glutz, Pindora …), Schlüsselboxen oder persönliche Übergabe. Die Guest App darf an keines davon gebunden sein; Nuki ist **nicht** das Domain-Modell.

## Entscheidung

**Port** `AccessProvider.getCredential(request) → AccessCredential | undefined` in `@up/core`. Das normalisierte `AccessCredential`: `type` (`pin | link | keybox | physical_key | other`), `status` (`scheduled | active | revoked | expired`), `validFrom`, `validUntil`, `displayValue` (nur wenn zeigbar), `instructions`, `provider`, `externalCredentialId`. Lock-IDs, Provider-Modelle und Provider-Namen erreichen den Browser nie.

**Eine Entscheidung:** `getAccessForStay({ config, window, registrationCompleted, now, loadCredential, includeDisplayValue })` → `available` (Credential ohne Code) · `pending` (`registration-required`, `not-yet-released` mit Zeitpunkt, `not-issued`) · `manual` (Hinweise). Reihenfolge: Aufenthalt vorbei → Registrierungspflicht → Freigabezeit → Modus. Der Provider wird erst gefragt, wenn alle Regeln erfüllt sind.

**Konfiguration pro Objekt** (`property_journey_settings.access`): `mode` (`manual | keybox`; Smart-Lock-Modi folgen mit ihrem Adapter), `release` (`arrival-day` = ab 00:00 Ortszeit am Anreisetag, oder `check-in-time`), `requiresCompletedRegistration` (**getrennt** von der Registrierungskonfiguration), `instructions` (DE/EN).

**Schlüsselbox (sicher):**

- Ein Code pro Unit (`unit_access_codes`), nicht pro Reservierung – keine unnötige Vervielfältigung.
- Nur verschlüsselt gespeichert: AES-256-GCM mit `ACCESS_CODE_KEY` (32 Byte, nur Server). `tenant/property/unit` als Associated Data – ein kopierter Wert entschlüsselt in keiner anderen Unit. Check-Constraint erzwingt das Chiffrat-Format.
- Der Code ist **nicht** im HTML/RSC-Payload. Der Gast tippt „Code anzeigen“; eine Server Action prüft Session, Freigabe und Registrierungspflicht erneut, ist pro Reservierung rate-limitiert (20/15 min), protokolliert das Ereignis ohne Code und liefert den Code nur in dieser POST-Antwort. Kein Code in URLs, Logs, Analytics oder Browser-Speicher.
- Ohne Schlüssel, ohne gespeicherten Code oder bei Entschlüsselungsfehler: manuelle Hinweise statt Fehler.
- Rotation: neuen Code verschlüsselt speichern (überschreibt); Schlüsselrotation über erneutes Verschlüsseln (Versionspräfix `v1.` vorbereitet).

**Manuell:** keine Daten, nur die gepflegten Hinweise (ohne Hinweise ein neutraler Standardtext).

**Smart Locks später:** Adapter implementiert denselben Port (Credential für Reservierung ausstellen/abfragen, `externalCredentialId` speichern, Status normalisieren). Keine Codes erzeugen, solange kein Adapter freigegeben ist.

## Konsequenzen

- Neue Zugangssysteme ohne Änderung an STAY.
- Schlüsselbox-Codes brauchen `ACCESS_CODE_KEY` je Environment; die Pflege erfolgt heute über das Repository (Admin-Pflege folgt).
