# 0021 – Mehrstufige Check-in-Validierung, Kontaktbestätigung und Firmen-Rechnungsadresse

**Status:** Akzeptiert für die Umsetzung in Phasen (2026-11-05).

- **Phase C1** ist umgesetzt: Kernlogik und Tests in `@up/core`. Die Logik ist noch nicht an die Apps angebunden.
- Ab C2 braucht jede Phase eine eigene Freigabe.

Ergänzt:

- [ADR 0016](0016-guest-journey-and-online-check-in.md) (Online-Check-in und Registrierungs-Sync)
- [ADR 0017](0017-provider-neutral-access.md) (Zugang)
- [ADR 0018](0018-payments-and-access-gating.md) (Zahlungen und Apaleo Finance)

> Rechtliche Aussagen (Meldepflicht, Rechnungsangaben, Aufbewahrung) sind **Arbeitsannahmen**. Sie ersetzen keine Rechts- oder Steuerberatung und werden vor dem Livegang geprüft. Offene Punkte stehen in §9.

## Kontext

Der Online-Check-in (ADR 0016) erfasst Gäste- und Meldedaten. Folgendes fehlte bisher:

- eine Bestätigung der Kontaktdaten;
- eine Plausibilitätsprüfung der Adresse;
- eine serverseitige Prüfung, dass die verantwortliche Person volljährig ist;
- länderspezifische Meldevorlagen;
- eine Trennung von Meldedaten und Betriebskontaktdaten;
- eine optionale Firmen-Rechnungsadresse, die später an die Apaleo-Folios übergeben wird.

### Bestand (Analyse 2026-11-05)

| Bereich           | Vorhanden                                                                                                               | Lücke (vor C1)                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Datenmodell       | `REGISTRATION_FIELDS`, Pflichtfelder je Rolle, Kinderregel (`registration-model.ts`, `registration-rules.ts`)           | kein Status je Prüfdimension; Melde- und Kontaktdaten gemischt |
| E-Mail            | Relay-Erkennung `usableContactEmail` (`…@guest.booking.com` → keine E-Mail)                                             | keine Bestätigung, kein Mail-Provider im Code                  |
| Telefon           | `normalizePhone` (libphonenumber, E.164, `not-mobile`)                                                                  | keine SMS-Bestätigung                                          |
| Alter             | `ageOn`                                                                                                                 | Regel „verantwortliche Person ≥ 18“ fehlt                      |
| Missbrauchsschutz | Tabelle `rate_limit_buckets`                                                                                            | nicht für Codes genutzt                                        |
| Meldewesen        | `guest_registration_syncs` mit Backoff. Feratel ist ein Skelett (`implemented = false`). Das Apaleo-Write-back ist aus. | Vorlagen je Land fehlen                                        |
| Zugang            | Die Entscheidung fällt nur in `getAccessForStay`.                                                                       | bleibt unverändert (siehe §8)                                  |
| Apaleo Finance    | Nur lesend (ADR 0018).                                                                                                  | kein Schreibpfad für die Rechnungsadresse                      |

## Entscheidung

### Entscheidungen des Betreibers (2026-11-05)

1. **Adressvorschläge über Google Places.** Manuelle Eingabe bleibt jederzeit möglich.
2. **E-Mail** über den vorhandenen **Resend**-Account.
3. **SMS** über **seven.io**, vorerst nur vorbereitet.
   - Unterstützt werden zunächst DE, AT und CH.
   - Weitere Länder lassen sich per Konfiguration ergänzen.
   - Internationale Gäste werden dadurch nie vom Check-in ausgeschlossen.
4. **E-Mail-Bestätigung ist Pflicht**, bevor der Online-Check-in als vollständig gilt.
   - Die SMS-Bestätigung ist nur vorbereitet und derzeit nicht verpflichtend.
   - Für Ausnahmefälle gibt es eine manuelle, protokollierte Alternative.
5. **Meldevorlagen:** zuerst Deutschland für HØV und LÆKE, danach Österreich für HŪSLE und ΛLPILΛ. Die Anforderungen der Gemeinden (Kurtaxe, Meldedaten) sind zunächst offene Prüfpunkte.
6. **Firmenrechnung:** Die Firma ist der Rechnungsempfänger. Der Gast kann optional als Ansprechpartner genannt werden, bleibt aber nicht automatisch Empfänger.
7. Der Apaleo-Scope **`invoices.read`** wird für die spätere Integration eingeplant.

### 1. Getrennte Status statt „verifiziert“

| Dimension           | Werte                                                                                                  | Höchster Wert bedeutet **nicht** …               |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `data`              | `incomplete` · `complete`                                                                              | … dass die Angaben stimmen                       |
| `address`           | `unverified` · `formally-valid` · `postally-plausible`                                                 | … dass der Gast dort wohnt                       |
| `age`               | `missing` · `invalid` · `declared-under-age` · `declared-adult`                                        | … dass der Gast volljährig ist (nur Angabe)      |
| `email` / `phone`   | `none` · `pending` · `verified` · `locked` · `waived` · `unsupported-country` · `disabled`             | … Identität (nur Kontrolle über Postfach/Nummer) |
| `identity`          | `not-required` · `pending-on-site` · `checked-by-staff`                                                | – (setzt nur das Team, nie die App)              |
| `legalRegistration` | `not-required` · `pending` · `submitted` · `failed` · `manual`                                         | –                                                |
| `billing`           | `private` · `company-pending` · `company-applied` · `company-manual` · `company-failed`                | –                                                |
| `vatId`             | `not-provided` · `format-valid` · `vies-valid` · `vies-invalid` · `vies-unavailable` · `not-checkable` | … dass die Firma die Nummer führt                |

**`completeness`** ist `complete`, wenn drei Bedingungen erfüllt sind:

- Die Daten sind vollständig.
- Die verantwortliche Person ist laut ihrer Angabe volljährig.
- Die E-Mail ist bestätigt (`verified`) oder vom Team protokolliert freigestellt (`waived`).

Nicht blockierend sind:

- die Plausibilität der Adresse (manuelle Eingabe ist immer zulässig);
- Telefon und SMS;
- die Identitätsprüfung;
- die Meldung;
- die Rechnungsadresse.

**Wortlaut gegenüber Gast und Team:**

- Für Adressen heißt es „formal gültig“, „postalisch plausibel“ oder „nicht verifiziert“.
- „Bestätigt“ gibt es nur für E-Mail und Telefon.
- Eine Freistellung durch das Team heißt „freigestellt“, nie „bestätigt“.

### 2. Adressvalidierung

- **Formal gültig** (lokal, ohne Provider):
  - Straße, Ort und Land sind vorhanden, das Land ist ein ISO-Code.
  - Die PLZ passt zum Muster des Landes (`postal-codes.ts`, rund 40 Länder).
  - Länder ohne bekanntes Muster bekommen nur die allgemeine Prüfung.
  - In Ländern ohne Postleitzahlen (z. B. AE, HK) darf die PLZ fehlen.
  - Steuerzeichen und Markup werden abgewiesen.
- **Postalisch plausibel:** Der Provider meldet einen Treffer auf Gebäudeebene (`premise` oder `sub-premise`) und hat keine Bestandteile ergänzt oder ersetzt. Zusätzlich muss die gespeicherte Adresse **genau** dem Provider-Ergebnis oder der unveränderten Autocomplete-Auswahl entsprechen. Ändert der Gast danach etwas, fällt der Status auf „formal gültig“ zurück.
- **Nicht verifiziert:** Die Adresse ist unvollständig oder fehlerhaft.
- **Fällt der Provider aus,** bleibt der Status „formal gültig“, und der Check-in läuft weiter.
- **Anbieter:** Google Places API (New) für Autocomplete und Place Details, dazu die Address Validation API.
  - Der Aufruf läuft ausschließlich serverseitig über einen Proxy, der an die Gast-Session gebunden ist. Der Key bleibt in einer Env-Variable.
  - Gesendet werden nur Adress-Teilstrings, keine Namen und keine Buchungsdaten.
  - Suchanfragen werden nicht gespeichert.
  - Für die Abrechnung werden Session-Tokens verwendet. Autocomplete-Sessions mit anschließendem Details-Abruf sind im Freikontingent; das Kontingent der Address Validation laut [Google-Preisen](https://developers.google.com/places/web-service/usage?hl=en).
  - Die Port-Schnittstelle ist `AddressProvider`.

### 3. E-Mail-Code (Pflicht)

- **Nur für den Hauptgast.** Relay-Adressen sind keine gültige E-Mail und können deshalb nie bestätigt werden.
- **Code:** 6 Ziffern aus dem CSPRNG. Gespeichert wird nur `HMAC-SHA256(pepper, challengeId ‖ code)`; der Pepper ist das Server-Secret `OTP_PEPPER` mit mindestens 32 Zeichen.
  - Gültigkeit 10 Minuten, nur einmal verwendbar.
  - Nach 5 Fehleingaben ist der Code gesperrt. Auch falsch formatierte Eingaben zählen als Versuch.
  - Der Vergleich ist zeitkonstant.
- **Versandgrenzen:**
  - frühestens nach 60 s erneut;
  - höchstens 5 Versände pro Reservierung in 24 h;
  - höchstens 3 verschiedene Zieladressen in 24 h.
  - Zusätzlich greift ein IP-Limit über `rate_limit_buckets` (C3).
  - Die Antworten sind einheitlich, damit niemand ausprobieren kann, welche Adressen existieren.
- **Bindung an den Wert:** Gespeichert wird der Hash des bestätigten Werts (`contactTargetHash`). Ändert der Gast die Adresse, ist die Bestätigung hinfällig.
- **Manuelle Alternative (`waived`):**
  - Nur ein Admin kann sie setzen.
  - Pflicht sind die Admin-ID und ein Grund (`guest-has-no-own-email`, `delivery-failed`, `confirmed-in-person`, `other`). Bei `other` ist eine Notiz Pflicht.
  - Jede Freistellung wird protokolliert (C2).
  - Der Status lautet „freigestellt“, nie „bestätigt“.
- **Versand über Resend.** In der Mail stehen nur der Code und der Objektname. Inhalt und Empfänger werden nicht geloggt.
  - Datenschutzhinweis: Die Daten liegen bei Resend in den USA (DPF/SCC, AVV abschließen). Die EU-Region betrifft nur den Versand ([Resend Regions](https://www.resend.com/docs/dashboard/domains/regions.md)).

### 4. SMS-Code (vorbereitet, optional)

- Gleiche Code-Logik wie bei E-Mail, aber strengere Grenzen:
  - frühestens nach 90 s erneut;
  - höchstens 3 Versände in 24 h;
  - höchstens 2 Zielnummern in 24 h.
- Unterstützte Länder: `supportedCountries`, Standard **DE, AT, CH**, erweiterbar.
  - Andere Nummern bekommen den Status `unsupported-country`. Das blockiert nie und schließt keinen Gast aus.
- `mode` ist **`off`**. Das Schema erlaubt nur `off` und `optional`; „Pflicht“ ist bewusst nicht konfigurierbar.
- Anbieter **seven.io** (EU/DE, [Übersicht](https://european-alternatives.eu/de/produkt/seven), etwa 0,075 € pro SMS nach DE, Preis vor Vertrag prüfen).
  - Vor dem Livegang kommt ein Budgetdeckel gegen SMS-Pumping dazu.

### 5. Alter, Meldedaten, Begleitpersonen

- **Verantwortliche Person:** Der Hauptgast muss am lokalen Anreisetag mindestens `responsibleAdultMinAge` alt sein (Standard 18). Das wird nur serverseitig geprüft (`responsibleAdultStatus`).
  - Ungültig sind ein Geburtsdatum in der Zukunft oder nach dem Anreisetag sowie ein Alter über 120 Jahre.
  - Begleitpersonen und Kinder dürfen minderjährig sein.
  - Das Ergebnis ist nur eine **Angabe** (`declared-adult`). Eine echte Prüfung ist nur über ein Ausweisdokument möglich, und die macht das Team (`identity`).
- **Trennung Melde- und Kontaktdaten** (`FIELD_DATA_CLASS`):
  - **Meldedaten** (`legal`): Name, Geburtsdatum, Staatsangehörigkeit, Adresse, Dokument. Sie unterliegen der gesetzlichen Frist.
  - **Kontaktdaten** (`contact`): E-Mail, Telefon. Sie haben einen eigenen Zweck und eine kürzere Frist; ab C2 liegen sie in einer eigenen Tabelle.
- **Gemeinsame Adresse:** `addressSource: "same-as-primary"` wird als Verweis gespeichert, nicht als Kopie, und erst beim Absenden aufgelöst. Erlaubt ist das nur bei `sharedAddress: "allowed"`.
- **Vorlage DE** (`DE_BMG_TEMPLATE`, Status `draft-legal-review`, für HØV und LÆKE), Grundlage BMG §§ 29, 30:
  - Seit dem BEG IV (ab 01.01.2025) gilt die besondere Meldepflicht nur noch für ausländische Personen.
  - **Hauptgast, immer:** Name, Geburtsdatum, Staatsangehörigkeit, Adresse.
  - **Hauptgast mit nicht deutscher Staatsangehörigkeit:** zusätzlich Dokumentart und Dokumentnummer.
  - **Erwachsene Begleitpersonen ohne deutsche Staatsangehörigkeit:** Geburtsdatum, Staatsangehörigkeit, Dokument. **Minderjährige** ohne deutsche Staatsangehörigkeit: Geburtsdatum und Staatsangehörigkeit.
  - Ist die Staatsangehörigkeit unbekannt, gilt die strengere Variante.
  - Aufbewahrung: ein Jahr ab Anreise, Vernichtung binnen drei Monaten.
  - `configFromTemplate` erzeugt nur einen **deaktivierten** Konfigurationsvorschlag. Es wird nichts automatisch angewendet.
- **Vorlage AT** (MeldeG § 5, Gästeblatt, Sammelblatt für Familien, Feratel) folgt nach DE.
- **Apaleo-Registrierungs-Write-back und Feratel bleiben aus.** Die neuen Status werden nicht an Apaleo übertragen.

### 6. Firmen-Rechnungsadresse

- **Eigener Schritt `billing`** zwischen `address` und `review`:
  - **Privat – meine angegebene Adresse verwenden** (Standard);
  - **Geschäftlich – Rechnung an eine Firma**.
- **Felder:**
  - Pflicht: Firmenname, Straße und Hausnummer, PLZ, Ort, Land;
  - optional: USt-IdNr. und Ansprechpartner (Vor- und Nachname).
  - Die **Firma ist Empfänger**. Der Gast ist höchstens „z. Hd.“.
- Die Rechnungsadresse wird **getrennt von der Meldeadresse** gespeichert und validiert (`normalizeBillingInput`). Die private Adresse wird nie überschrieben.
- **USt-IdNr.:**
  - Formatprüfung für alle EU-Staaten, XI, CH und GB (`checkVatIdFormat`).
  - Danach optional die VIES-Abfrage (`VatIdChecker`, kostenlos). Fällt VIES aus, gilt `vies-unavailable`; das blockiert nie.
  - Die qualifizierte Bestätigung bleibt bei der Buchhaltung.

#### Apaleo-API: Möglichkeiten und Grenzen (Finance v1, geprüft 2026-11-05)

| Bedarf                  | Endpunkt                                                                                                            | Scope                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Folios der Reservierung | `GET /finance/v1/folios?reservationIds=…` (auch `bookingIds`, `type`)                                               | `folios.read`                          |
| Rechnungen              | `GET /finance/v1/invoices?folioIds=…` (auch `reservationIds`, `bookingIds`, `status`), dazu Folio-`relatedInvoices` | **`invoices.read`**                    |
| Adressänderung erlaubt? | Folio `allowedActions` (`ChangeAddress`, `ChangeAddressWithSimpleDebitor`), Warnung `IncompleteBillingAddress`      | `folios.read`                          |
| Empfänger setzen        | `PATCH /finance/v1/folios/{id}`: „Replace debitor (guest folios only)“, „Add / Replace / remove a company“          | `folios.manage` (`core.folios.modify`) |

`FolioDebitorModel` sieht so aus:

```
{ type, title, firstName, name,
  address{addressLine1, addressLine2, postalCode, city, regionCode, countryCode},
  company{name*, taxId, additionalTaxId, …},
  personalTaxId, reference, email, phone }
```

Grenzen:

- **Nur `company` zu ergänzen reicht nicht:** Dann stünde der Firmenname mit der **Privatanschrift** auf der Rechnung. Deshalb wird der Debitor **ersetzt**: Firmenadresse plus `company{name, taxId}` und optional ein Ansprechpartner.
- **Der Debitor gehört zum Folio.** `reservation.primaryGuest` wird nie geschrieben.
- **Im Developer-Account zu prüfen:** ob neue Folios den Debitor vom Gast oder Bucher übernehmen, und wie Ansprechpartner und Firma auf der Rechnung dargestellt werden.
- **Bestehende Rechnungen werden nie geändert.** Eine Korrektur geht nur per Storno und Neuausstellung durch die Buchhaltung. `invoice-actions` (pay, cancel) werden nie benutzt.
- **Keine Optimistic Concurrency dokumentiert:** Vor dem PATCH wird neu gelesen, danach erneut gelesen und der Fingerprint verglichen.
- **Keine Webhooks:** Sie sind unsigniert und kommen ungeordnet an. Für die Rechnungsadresse sind sie unnötig.

#### Übertragungsplan (`planBillingTransfer`, rein, in C1 umgesetzt)

Die Prüfungen laufen je Folio in dieser Reihenfolge:

| Bedingung                                                 | Aktion                                                    |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Es gibt eine Rechnung                                     | `skip-invoiced` (gewinnt immer)                           |
| Andere Reservierung der Buchung                           | `manual-other-reservation`                                |
| Kein Gast-Folio (Booking, House, External)                | `manual-not-guest-folio`                                  |
| Folio geschlossen                                         | `skip-closed`                                             |
| Gleicher Fingerprint schon übertragen                     | `already-applied`                                         |
| Fremder Firmen- oder Drittdebitor (nicht von uns gesetzt) | `manual-third-party-debitor`                              |
| Apaleo erlaubt keine Adressänderung                       | `skip-address-change-not-allowed`                         |
| sonst                                                     | `apply`, ausführbar **nur** mit `billingWriteBack = true` |

- `billingWriteBack` ist im Schema auf `false` festgelegt (`z.literal(false)`). Ein Einschalten erfordert eine Codeänderung **und** eine Freigabe.
- `needsStaff` ist gesetzt, sobald ein Folio manuell behandelt werden muss oder gar kein Folio adressierbar ist.
- **Admin (C7/C8):**
  - Status je Folio.
  - „Erneut übertragen“ gibt es nur bei `failed` oder `manual` und nur für Rollen mit Finanzrecht; die Vorbedingungen werden dabei neu geprüft.
  - Protokoll ohne Adressinhalte.
- **Rechnungsanforderungen (Arbeitsannahme, mit Steuerberatung prüfen):**
  - **DE:** § 14 Abs. 4 UStG verlangt Name und Anschrift des Empfängers. Kleinbetragsrechnungen bis 250 € (§ 33 UStDV) brauchen keine. Die Beherbergung wird am Ort des Grundstücks besteuert (§ 3a Abs. 3 UStG), es gibt also kein Reverse-Charge. Die E-Rechnungspflicht im B2B-Bereich (Ausstellung ab 2027/2028) liegt bei der Rechnungserzeugung in Apaleo.
  - **AT:** § 11 UStG verlangt Name und Anschrift. Kleinbetragsrechnungen gibt es bis 400 €. Die UID des Empfängers ist ab 10.000 € brutto Pflicht.
  - **Getrennte Rechnungen** (Firma und privat) sind ein Folio-Split im Backoffice und werden nicht automatisiert.

### 7. Sicherheit und Datenschutz

- **Keine Ausweiskopien.** Es gibt kein Upload-Feld.
  - `identity` speichert nur, wer wann welche Dokumentart geprüft hat.
  - Eine Dokumentnummer wird nur gespeichert, wenn die Meldevorlage sie verlangt.
- **Serverseitig bleiben:** Codes, Hashes, Provider-Keys, VIES-Antworten und Apaleo-Tokens.
  - Der Client sieht nur Status und maskierte Ziele (`maskEmail`, `maskPhone`).
  - Neue Tabellen bekommen RLS ohne Policies und keine Data-API-Rechte (Muster aus Migration 0012).
- **Keine Inhaltsdaten in Logs:** keine Adressen, E-Mails, Telefonnummern oder Codes, nur IDs und Fehlercodes.
- **Löschung je Datenart** über `purge_after` (C2):

  | Datenart         | Frist                                                                                                  |
  | ---------------- | ------------------------------------------------------------------------------------------------------ |
  | Meldedaten       | gesetzlich, je Vorlage                                                                                 |
  | Kontaktdaten     | 30 Tage nach Abreise (Vorschlag)                                                                       |
  | Code-Datensätze  | 24 h nach Ablauf                                                                                       |
  | Rechnungsadresse | 30 Tage nach erfolgreicher Übertragung. Die steuerliche Aufbewahrung liegt bei der Rechnung in Apaleo. |

- **Auftragsverarbeitung:** AVV/DPA mit Google, Resend und seven.io; Einträge im Verarbeitungsverzeichnis; ein Abschnitt in der Datenschutzerklärung.

### 8. Zugang

- `getAccessForStay` bleibt **unverändert**. Kein Validierungs- oder Bestätigungsstatus gibt Zugang frei.
- In C1 wird **keine** neue Zugangssperre eingeführt.
- Ob „Check-in vollständig“ später eine _zusätzliche_ Bedingung für den Zugang wird, ist eine eigene Entscheidung mit eigener Freigabe.

### 9. Offene Prüfpunkte

1. BMG § 29 Abs. 2: Familienausnahme für Dokumentdaten mitreisender Ehe-/Lebenspartner und minderjähriger Kinder (`de-family-exemption`).
2. Kurtaxe- bzw. Gästebeitragssatzung der Gemeinden von HØV und LÆKE: Welche Daten werden für **alle** Gäste verlangt? Welche Gästekarte, welches Meldesystem (`de-kurtaxe-hov`, `de-kurtaxe-laeke`)?
3. Anforderungen an den elektronischen Meldeschein nach BMG § 29 Abs. 5 (`de-digital-form`).
4. Abweichende Aufbewahrungsfristen der Gemeinden (`de-retention`).
5. AT: Gästeverzeichnis, Aufbewahrungsfrist, Landestourismusgesetze, Feratel-Schnittstelle (Dokumentation, Testzugang).
6. Debitor-Darstellung und Ansprechpartner auf der Apaleo-Rechnung (Developer-Account).
7. AVV und DPA mit Google, Resend und seven.io.

## Phasen

Jede Phase gilt nur für TEST bzw. Staging und braucht eine eigene Freigabe.

| Phase  | Inhalt                                                                                                                                                                                                       | Status                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| **C1** | Statusmodell, Validierungsregeln (Adresse, Alter, gemeinsame Adresse, Datenklassen), Code-Logik, DE-Vorlage, Rechnungsadresse und USt-IdNr., Übertragungsplan, Ports, Tests                                  | **umgesetzt (2026-11-05)** |
| C2     | Datenbank (Staging): `guest_contact_points`, `contact_verifications`, Adressstatus, `billing_addresses`, `billing_address_syncs`, `billing_address_events` (append-only), Freistellungsprotokoll, Purge, RLS | offen                      |
| C3     | Rechnungsadresse in UI und Daten (aktuelle App und V2), VIES-Adapter, Admin-Anzeige; noch kein Apaleo-Schreiben                                                                                              | offen                      |
| C4     | E-Mail-Code mit Resend (Mock zuerst), UI mit Countdown, Freistellung im Admin                                                                                                                                | offen                      |
| C5     | SMS-Code mit seven.io (vorbereitet, `off`), Länderliste, Budget                                                                                                                                              | offen                      |
| C6     | Google-Places-Proxy und Autocomplete-Komponente mit manuellem Fallback                                                                                                                                       | offen                      |
| C7a    | Apaleo-Vorschau, nur lesend (Folios, Rechnungen → Plan im Admin)                                                                                                                                             | offen (`invoices.read`)    |
| C7b    | Apaleo-Schreiben, nur im Developer-Account                                                                                                                                                                   | offen (`folios.manage`)    |
| C8     | Datenschutz-Abschluss: Purge-Jobs, Löschung auf Anfrage, Texte                                                                                                                                               | offen                      |

**Geplante Env-Variablen.** Die Werte setzt der Betreiber, nie im Chat:

- `OTP_PEPPER`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `SEVEN_API_KEY`
- `GOOGLE_MAPS_API_KEY` (nur Server)

## Umsetzung C1 (2026-11-05)

Alles liegt in `packages/core/src/` und ist über `@up/core` exportiert. Die Module sind reine Funktionen ohne I/O und ohne Anbindung an die Apps.

- `address/postal-codes.ts`, `address/address-check.ts` (`assessAddress`, `addressIssues`, `sameAddress`) und `address/address-provider.ts` (Port)
- `verification/otp.ts`: Code, HMAC, `canIssueOtp`, `attemptOtp`, Maskierung
- `verification/contact-verification.ts`: Status, Freistellung, SMS-Verfügbarkeit
- `verification/message-ports.ts`: Ports für E-Mail und SMS
- `registration/responsible-adult.ts`, `registration/data-classification.ts`, `registration/shared-address.ts`, `registration/legal-templates.ts` (DE)
- `billing/vat-id.ts`, `billing/billing-address.ts`, `billing/billing-transfer.ts`
- `check-in-status/validation-policy.ts` (Standard laut Entscheidungen) und `check-in-status/check-in-status.ts` (`deriveCheckInStatus`)

Tests: 6 neue Testdateien mit 117 Tests. Die Core-Suite hat jetzt insgesamt 236 Tests.

Unverändert geblieben sind:

- bestehende Check-in-Regeln und -Abläufe;
- `assessRegistration`;
- Datenbank und Migrationen;
- Apps und UI;
- Apaleo und Feratel;
- `getAccessForStay`.

Es werden keine Nachrichten versendet.

## Konsequenzen

- Die Statuslogik liegt an einer Stelle und ist getestet. UI, Datenbank und Adapter (C2–C7) setzen darauf auf, ohne die Regeln zu duplizieren.
- „Verifiziert“ kann technisch nur für E-Mail und Telefon entstehen, und nur über einen Code. Adresse, Alter und Identität haben dafür keinen Wert.
- Das Schreiben der Rechnungsadresse ist durch das Schema gesperrt. Für das Freischalten sind Codeänderung, Review und Freigabe nötig.
- Die Pflicht zur E-Mail-Bestätigung wird erst wirksam, wenn C4 die Bestätigung im Check-in anbietet. Bis dahin bleiben bestehende Check-ins unverändert.
