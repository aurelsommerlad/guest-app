# 0013 – GUIDE-Content-Management in der Datenbank

**Status:** Akzeptiert (2026-10-05, Phase 9). Löst die Mock-Daten aus [ADR 0007](0007-guide-content-model.md) ab. Modell, Scope und `Visibility` aus ADR 0007 bleiben gültig.

## Kontext

GUIDE-Inhalte lagen bisher als typisierte Mock-Daten im Code. UNIQUE PLACES soll sämtliche GUIDE-Inhalte selbst über eine Admin App pflegen: allgemeine Inhalte pro Tenant oder Property und abweichende Inhalte für einzelne Apartments. Gäste sehen pro Thema genau einen Eintrag. Später sollen weitere Tenants dazukommen und Übersetzungen per AI vorbereitet werden.

## Entscheidung

**Eine Tabelle `guide_sections`** mit zwei Arten von Einträgen (`kind`):

| Art        | Scope                  | Inhalt                                                                                                     |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `topic`    | tenant, property, unit | Metadaten (Titel, Slug DE/EN, Icon, Eyebrow, Kurzbeschreibung, Sortierung, `visibility`) + Standard-Inhalt |
| `override` | nur unit               | nur Inhalt (Intro, Titelbild, Blöcke) für ein Apartment; Metadaten kommen immer vom Thema                  |

- Themen und Varianten sind über einen stabilen **`key`** verbunden (z. B. `wlan`). Der Key wird beim Anlegen aus dem Titel erzeugt und ändert sich danach nicht. Slugs dürfen sich ändern.
- Lokalisierte Felder (Titel, Slug, Texte) sind `jsonb` `{ de, en? }`. Blöcke sind ein `jsonb`-Array strukturierter Blöcke (`heading`, `paragraph`, `list`, `callout`, `link`, `image`), kein HTML. Validierung mit Zod in `@up/core` (`guideContentSchema`, `guideTopicMetaSchema`), zusätzlich Check-Constraints in der DB.
- Integrität:
  - `tenant_id NOT NULL`; zusammengesetzte FKs `(tenant_id, property_id)` und `(tenant_id, property_id, unit_id)`. Ein Eintrag kann nie an einer Property oder Unit eines anderen Tenants hängen.
  - Check-Constraints für Scope-Form (`tenant` ohne Property/Unit, `property` mit Property, `unit` mit beidem), Topic-Form (Titel/Slug Pflicht), Override-Form (nur Unit-Scope, keine Metadaten) und gültige Icons.
  - Partieller Unique-Index: pro Tenant, Art, Property, Unit und Key höchstens **ein nicht archivierter** Eintrag.
- **Status** `draft | published | archived`. Es gibt keine Versionierung: Speichern eines veröffentlichten Eintrags ist sofort live. Nur `published` ist öffentlich. `first_published_at` merkt sich die erste Veröffentlichung; nur nie veröffentlichte Einträge dürfen gelöscht werden, sonst wird archiviert.

**Auflösung** (`resolveGuideSections` in `@up/core`, rein und getestet):

1. Kandidaten sind veröffentlichte Themen desselben Tenants, deren Scope zum Gast passt (Tenant, eigene Property, eigene Unit) und deren `visibility` jetzt gilt.
2. Pro Key gewinnt das spezifischste Thema (unit > property > tenant).
3. Gibt es eine veröffentlichte Variante (`override`) für die Unit des Gastes mit demselben Key, ersetzt sie den Inhalt. Metadaten, Slug und Sortierung bleiben vom Thema.
4. Blöcke werden nach ihrer eigenen `visibility` gefiltert, Ergebnis nach `sort_order` sortiert.

Ohne Unit (z. B. Gast ohne zugewiesenes Apartment) sieht der Gast den allgemeinen Inhalt.

**Guest App:** liest über `listPublishedGuideEntries` (tenant-scoped, nur `published`, nur passende Property/Unit) und den Guest Context aus [ADR 0012](0012-guest-context.md). Ohne Datenbank oder bei Fehlern zeigt GUIDE einen leeren Zustand („Die Inhalte für Deinen Aufenthalt bereiten wir gerade für Dich vor.“) und loggt den Fehler ohne Inhalte.

**Übersetzung:** Quellsprache ist Deutsch (`source_locale = 'de'`). `translation_state` (`jsonb`, z. B. `{ "en": "reviewed" }`) mit den Werten `missing | outdated | machine | reviewed` bereitet eine spätere AI-Übersetzung vor. Heute setzt die Admin App den Zustand selbst: `reviewed`, wenn alle Texte eine englische Fassung haben, sonst `missing`. Fehlt EN, zeigt die Guest App DE.

**Medien (Supabase Storage)**, ab Phase 9.1 als signierter Direkt-Upload:

- Ein öffentlich lesbarer Bucket (`GUIDE_MEDIA_BUCKET`, Standard `guide-media`) pro Supabase-Projekt, angelegt im Dashboard: **8 MB, nur `image/jpeg`, `image/png`, `image/webp`**. Es gibt **keine** Storage-Policies für Schreibzugriffe; `anon` und `authenticated` können nicht hochladen.
- Ablauf (offizielle Storage-API, entspricht supabase-js `createSignedUploadUrl` / `uploadToSignedUrl`):
  1. Der Browser fragt eine Server Action nach einer Upload-Berechtigung und sendet nur Dateityp und Größe. Die Admin App prüft Admin Session, Tenant (aus der Session), Property (tenant-scoped aus der DB), Typ (JPG/PNG/WebP), Größe (1 Byte bis 8 MB) und ein Rate Limit (60 Berechtigungen pro 15 Minuten und Konto).
  2. Die Admin App erzeugt den Pfad selbst, `<tenantId>/<propertyId>/guide/<uuid>.<ext>`, und lässt sich von Storage mit `SUPABASE_SERVICE_ROLE_KEY` ein signiertes Upload-Token für **genau diesen Pfad** ausstellen (`POST /storage/v1/object/upload/sign/{bucket}/{path}`, ohne Upsert).
  3. Der Browser lädt die Datei direkt zu Storage hoch (`PUT …/upload/sign/{bucket}/{path}?token=…`). Das Token gilt nur für diesen Pfad und erlaubt kein Überschreiben. Storage erzwingt die Größen- und MIME-Grenzen des Buckets.
  4. Eine zweite Server Action lädt das gespeicherte Objekt serverseitig und prüft Größe und Inhalt (Magic Bytes passend zur Endung). Alles andere wird sofort gelöscht. Erst danach bekommt der Editor die öffentliche URL.
- Beim Speichern eines Inhalts akzeptiert die Admin App nur URLs, die exakt dem Muster `…/object/public/<bucket>/<tenantId>/<propertyId>/guide/<uuid>.<ext>` der Session entsprechen (keine Präfix-Tricks, kein `..`; lokal zusätzlich `/fixtures/guide/…`). **Neue** Bilder werden dabei noch einmal am gespeicherten Objekt geprüft, auch wenn jemand die Oberfläche umgeht.
- Der Service-Role-Key verlässt nie den Server. Der Browser sieht nur das pfadgebundene Token. Laut Supabase-Dokumentation gilt es 2 Stunden; kürzer konfigurieren lässt es sich auf gehostetem Supabase nicht. Weil der Pfad zufällig ist, das Token nur diesen Pfad erlaubt und nicht überschreiben kann, ist das hinnehmbar.
- Warum kein Upload über den Server: Vercel begrenzt Request-Bodies von Functions auf 4,5 MB; Bilder bis 8 MB wären nicht möglich.
- Die Guest App lädt Bilder über `next/image`; `remotePatterns` erlaubt nur `${SUPABASE_URL}/storage/v1/object/public/**`.
- Nicht verwendete Uploads (abgebrochen oder ersetzt) bleiben vorerst im Bucket, kein Garbage Collection.

**Fixtures:** Die bisherigen HØV-Mock-Inhalte liegen als `packages/db/src/seed/guide-fixtures.ts` vor und werden nur lokal (`pnpm db:seed --target local --with-guide-fixtures`) und in Tests eingespielt. Staging und Production bekommen keine Mock-Inhalte; dort legt UNIQUE PLACES die echten Inhalte über die Admin App an.

## Konsequenzen

- Inhalte sind ohne Deployment änderbar. Fehler in veröffentlichten Inhalten sind sofort sichtbar, weil es keine Freigabestufe gibt.
- Ein Thema für alle Apartments plus wenige Varianten bleibt übersichtlich. Typ-spezifische Editoren (z. B. WLAN mit Netzwerk/Passwort) können später auf denselben Blöcken aufsetzen, ohne Schemaänderung.
- Die Admin App arbeitet pro Property: Themen für das gesamte Objekt oder nur ein Apartment, dazu Apartment-Varianten von Objekt-Themen. Tenant-weite Themen sind im Modell erlaubt, werden in der Admin App aber erst mit Bedarf (z. B. Hausordnung für alle Objekte) angeboten.
- RLS ist aktiv ohne Policies, `anon`/`authenticated` haben keine Rechte (Migration `0005`). Zugriffe laufen ausschließlich serverseitig über `@up/db` (siehe [ADR 0010](0010-database-foundation.md)).
