# Apaleo: Folios, Zahlungen und Apaleo Pay – verifizierte Grundlage

Stand: 2026-11-04. Nur dokumentierte Felder und Endpunkte. Konzept und Phasen: [ADR 0018](../adr/0018-payments-and-access-gating.md).

## Quellen

| Quelle                                                                                                                                                                                                                                  | Inhalt                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Offizielle OpenAPI-Spezifikation **Finance v1** (`api.apaleo.com/swagger/finance-v1/swagger.json`)                                                                                                                                      | Folios, Charges, Zahlungen, Payment Links           |
| Offizielle OpenAPI-Spezifikation **Booking v1** (`api.apaleo.com/swagger/booking-v1/swagger.json`)                                                                                                                                      | Reservierung, Stornogebühr, Garantie, Zahlungskonto |
| Offizielle OpenAPI-Spezifikation **Webhook v1** (`webhook.apaleo.com/swagger/webhook-v1/swagger.json`)                                                                                                                                  | Subscriptions, Topics                               |
| apaleo.dev: [Configure webhooks](https://apaleo.dev/guides/webhook/configuration), [Webhooks payload](https://apaleo.dev/guides/webhook/webhooks-payload.html), [Best practices](https://apaleo.dev/guides/webhook/best-practices.html) | Event-Namen, Payload, Zustellung                    |
| Offizieller Client `@apaleo/angular-api-proxy-finance` / `-booking` 19.0.29 (v0-nsfw)                                                                                                                                                   | Gegenprobe der Modelle                              |
| Lesender Abruf der Testreservierung JTKQSYFX-1 (Objekt TEST) über den Apaleo-Connector                                                                                                                                                  | Beobachtete Werte, keine Änderung                   |

## Reservierung (Booking v1, `ReservationModel`)

| Feld                                         | Bedeutung laut Spezifikation                                                                                                                                   | Beobachtet (JTKQSYFX-1)                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `cancellationFee.dueDateTime`                | „The date and time the cancellation fee will be due. After that time this fee will be charged in case of cancellation“ → **Ende der kostenfreien Stornierung** | 2026-12-29T16:00+01:00 (14 Tage vor Anreise)    |
| `cancellationFee.fee`                        | Höhe der Stornogebühr                                                                                                                                          | 198 EUR (nur Übernachtungen, ohne Endreinigung) |
| `cancellationFee.code/name/description`      | angewandte Stornobedingung                                                                                                                                     | `FLEX`                                          |
| `guaranteeType`                              | „The strongest guarantee for the rate plans booked“: `PM6Hold`, `CreditCard`, `Prepayment`, `Company`, `Ota`                                                   | `CreditCard`                                    |
| `paymentAccount.isVirtual`                   | „Indicates if the payment account is a virtual credit card“                                                                                                    | –                                               |
| `paymentAccount.isActive` / `inactiveReason` | Konto für Abbuchungen nutzbar                                                                                                                                  | –                                               |
| `hasActivePaymentAccount`                    | mindestens ein aktives Zahlungskonto                                                                                                                           | `false`                                         |
| `channelCode`                                | `Direct`, `BookingCom`, `Ibe`, `ChannelManager`, `Expedia`, `Hrs`, `AltoVita`, `DesVu`, `Gimsi`, `Homelike` (veraltet)                                         | `Direct`                                        |
| `company`                                    | Firma der Reservierung                                                                                                                                         | –                                               |
| `commission`                                 | OTA-Provision                                                                                                                                                  | –                                               |
| `balance`, `payableAmount.guest`             | vorhanden, **ohne Beschreibung** in der Spezifikation                                                                                                          | −337 / 337 EUR                                  |

Es gibt **kein** dokumentiertes Feld „Zahlung fällig am“. Fälligkeit ist deshalb eine eigene Regel (ADR 0018).

## Folio (Finance v1, `FolioModel`)

- `GET /finance/v1/folios?reservationIds=…&expand=charges,allowances` – alle Folios einer Reservierung (Scope `folios.read`).
- `type`: `Guest`, `Booking`, `House`, `External`; `isMainFolio`; `status`: `Open`, `Closed`, `ClosedWithInvoice`.
- `debitor.type`: `Booker`, `PrimaryGuest`, `AdditionalGuest`, `Company`, `Property` („When the folio has a company, the only possible value is 'Company'“).
- `balance` (MonetaryValue), `allowedPayment` („The maximum payment that can be posted on this folio“), `relatedFolios`.
- Charges: `serviceType` (`Accommodation`, `FoodAndBeverages`, `CancellationFees`, `NoShow`, `CityTax`, …), `type` (`TimeSlice`, `ExtraService`, `CityTax`, `CancellationFee`, …), `isPosted`, `serviceDate`, `amount.grossAmount`, `translatedNames`, `routedTo` / `movedTo` (Charge liegt eigentlich auf einem anderen Folio).

Beobachtet bei JTKQSYFX-1: ein Folio `JTKQSYFX-1-1`, `Guest`, Haupt-Folio, Debitor `PrimaryGuest`, Saldo **−337 EUR**. Charges: 2 × Übernachtung 99 EUR, Endreinigung 139 EUR, alle **noch nicht gebucht** (`isPosted: false`). Der Saldo enthält also schon vor Anreise den gesamten Aufenthalt. Ein negativer Saldo ist eine Forderung an den Debitor (beobachtet, nicht als Vorzeichenregel dokumentiert).

## Zahlungen (Finance v1)

| Endpunkt                                                       | Laut Spezifikation                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /finance/v1/folios/{folioId}/payments`                    | Zahlungen eines Folios, Filter `statusCodes` (`folios.read`)                                                                                                                                                                                                                                                                                         |
| `GET /finance/v1/folios/{folioId}/payments/{paymentId}`        | eine Zahlung                                                                                                                                                                                                                                                                                                                                         |
| `POST /finance/v1/folios/{folioId}/payments/by-link`           | „Creates a link to a payment form where guests can pay … processed asynchronously. Use the location header to poll for the status of the payment. As long as a payment is pending it reduces the amount of allowed payments for the folio.“ Scope `folios.manage`, Header `Idempotency-Key` („Keys expire after 24 hours“), Antwort 201 + `Location` |
| `PUT /finance/v1/folios/{folioId}/payments/{paymentId}/cancel` | „Sets a pending payment with payment link to cancelled“ (`folios.manage`)                                                                                                                                                                                                                                                                            |

`CreatePaymentLinkRequest`: `amount`, `expiresAt`, `countryCode`, `description`, `payerEmail`, `returnUrl` („Website URL used for redirection after payment is completed“), `paidCharges` (welche Charges die Zahlung deckt).

`FolioPaymentModel`: `status` (`Pending`, `Success`, `Failure`, `Canceled`), `failureCode` (`Failed`, `TimedOut`), `failureReason`, `type` (`PaymentLink`, `Custom`, `Terminal`, `PaymentAccount`, `Authorization`, `PreAuthorization`), `method` (u. a. `BookingCom`, `Airbnb`, `HolidayCheck`, `Psp*`, Kartenarten), `url`, `expiresAt`, `externalReference.pspReference`.

Kartendaten berühren die Guest App nie: Der Gast zahlt auf der Apaleo-Pay-Seite (Adyen).

## Webhooks

- Topics u. a. `Reservation`, `Folio`, `PaymentTransaction` (Webhook v1).
- Folio-Events: `balance-changed`, `payment-added`, `payment-posted`, `payment-failed`, `payment-canceled`, `charges-changed`, `charge-posted`, `payment-moved-from-folio`, `payment-moved-to-folio`, `debitor-changed`, `closed`, `reopened`, …
- Reservation-Events: `amended`, `changed`, `canceled`, `payment-account-set`, …
- Payload enthält **nur IDs** (`topic`, `type`, `id`, `accountId`, `propertyId`, `timestamp`, `data.entityId`).
- Zustellung **mindestens einmal**, ggf. doppelt, **ungeordnet**; bis zu 3 Wiederholungen, danach bis zu 24 h; Erfolg = 2xx.
- **Keine Signatur.** Empfohlen: HTTPS, Token in der Endpoint-URL, IP-Allowlist (34.240.36.71, 52.212.76.75, 63.33.249.221).

Folge: Ein Webhook ist nur ein **Auslöser**. Maßgeblich ist immer der anschließende API-Abruf.

## Offen, im Apaleo-Testsystem zu klären (vor Phase B)

1. Gibt es für Objekt TEST ein Apaleo-Pay-**Testkonto** (Adyen-Test), oder wären Payment Links echte Zahlungen?
2. Host der Payment-Link-URL (für eine Allowlist vor dem Redirect).
3. Wie Booking.com-/Expedia-Reservierungen mit „Payments by Booking.com“, Expedia Collect und virtueller Karte in Folios und `guaranteeType` tatsächlich aussehen (echte, anonymisierte Beispiele).
4. Ob `payableAmount.guest` verlässlich „vom Gast zu zahlen“ bedeutet (undokumentiert – bis dahin nur Plausibilitätsprüfung).
5. Wie die Apaleo-Zahlungsautomatik (falls aktiv) mit eigenen Payment Links zusammenspielt.
