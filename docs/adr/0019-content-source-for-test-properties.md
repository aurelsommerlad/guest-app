# 0019 – Inhaltsquelle für Testobjekte

**Status:** Akzeptiert (2026-11-04). Ergänzt [ADR 0013](0013-guide-content-management.md) und [ADR 0015](0015-explore-content-management.md).

## Kontext

Das Apaleo-Testobjekt TEST (Registry `testOnly`, in Production gesperrt) hat keine eigenen Inhalte. Mit der TEST-Reservierung sollen die echten HØV-Inhalte sichtbar sein, die zentral im Admin gepflegt werden. Folgende Wege scheiden aus:

- Inhalte kopieren: Es entstünden zwei Datenstände.
- Inhalte Tenant-weit anlegen: Dann sähen alle Objekte sie.
- Die Reservierung auf HØV umhängen: Zugang, Check-in und Reservierung würden vermischt.

## Entscheidung

**Inhaltsquelle in der Registry:**

- Ein Testobjekt kann `contentSource: { propertyId, units? }` tragen.
- TEST verweist auf HØV. Ap. 1 entspricht ROS. Ap. 2 hat keine Zuordnung und sieht die allgemeinen HØV-Inhalte.

**Eine Funktion:** `contentScopeOf(tenantId, property, unitId)` (`apps/guest/src/config/content-source.ts`) liefert den Inhaltsbereich. Er gilt für GUIDE (Abfrage und Sichtbarkeitsauflösung), EXPLORE (Abfrage und zweite Prüfung) und die Bildkarten auf STAY. Die Quelle gilt nur, wenn alle Bedingungen erfüllt sind:

- Das Objekt ist ein Testobjekt. Echte Objekte lesen immer ihre eigenen Inhalte, selbst wenn ein Verweis falsch eingetragen wäre.
- Die Quelle existiert und ist kein Testobjekt.
- Testobjekt und Quelle gehören zum Tenant des Gastkontexts. Der Tenant kommt immer aus Zugang/Kontext, nie aus der Registry.
- Eine Apartment-Zuordnung zeigt auf ein Apartment der Quelle, sonst gelten nur deren allgemeine Inhalte.

Schlägt eine Prüfung fehl, gilt der eigene, leere Inhaltsbereich. Ein Registry-Test erzwingt die Regeln bei jedem Build.

**Unverändert:**

- Reservierung, Gastname, Zeiten, Zugang, Check-in, Journey-Einstellungen und Header bleiben die des Testobjekts.
- Sichtbarkeitsregeln richten sich nach den Daten der TEST-Reservierung.
- Nur veröffentlichte Inhalte der Quelle sind sichtbar, genau wie für deren Gäste.

## Konsequenzen

- Keine Migration, keine Kopien, keine Änderung an Tenant-/Property-Trennung oder Admin.
- Änderungen an HØV-Inhalten im Admin sind sofort auch mit der TEST-Reservierung sichtbar (nur in Umgebungen, in denen TEST zugelassen ist, also nicht in Production).
- Weitere Testobjekte oder Quellen sind ein Eintrag in der Registry mit Review.
