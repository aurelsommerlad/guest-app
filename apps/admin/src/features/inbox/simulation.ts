/**
 * Realistic, fictitious guest conversations for the simulated channel (I2; local/staging
 * only). Names and texts are invented; the reservation JTKQSYFX-1 is the Apaleo TEST booking
 * (served by the Apaleo simulator locally).
 */
import type { ConversationChannel, ConversationKind } from "@up/core";

export type SimulatedScenario = {
  threadId: string;
  propertyId: string;
  channel: ConversationChannel;
  kind: ConversationKind;
  title: string;
  guestName: string;
  language?: string;
  reservationId?: string;
  messages: { id: string; direction: "inbound"; text: string; at: Date }[];
};

const minutes = (now: Date, ago: number) => new Date(now.getTime() - ago * 60_000);

export function simulatedScenarios(now: Date, propertyIds: readonly string[]): SimulatedScenario[] {
  // The Apaleo TEST property first: its reservation JTKQSYFX-1 exists in the simulator.
  const ordered = [...propertyIds].sort((a, b) =>
    a === "test-run" ? -1 : b === "test-run" ? 1 : a.localeCompare(b),
  );
  const pick = (index: number) => ordered[index % Math.max(ordered.length, 1)] ?? "test-run";
  const first = pick(0);
  return [
    {
      threadId: "sim-stay-anna",
      propertyId: first,
      channel: "stay_chat",
      kind: "reservation",
      title: "Anna Berger",
      guestName: "Anna",
      language: "de",
      reservationId: "JTKQSYFX-1",
      messages: [
        {
          id: "sim-stay-anna-1",
          direction: "inbound",
          text: "Hallo! Wir kommen am Dienstag mit dem Zug in Lindau an. Gibt es eine Möglichkeit, das Gepäck schon vor dem Check-in abzustellen?",
          at: minutes(now, 7),
        },
      ],
    },
    {
      threadId: "sim-booking-anna",
      propertyId: first,
      channel: "booking_com",
      kind: "reservation",
      title: "Anna Berger",
      guestName: "Anna",
      language: "de",
      reservationId: "JTKQSYFX-1",
      messages: [
        {
          id: "sim-booking-anna-1",
          direction: "inbound",
          text: "Ist ein Kinderbett im Apartment vorhanden? Unsere Tochter ist 9 Jahre alt.",
          at: minutes(now, 60 * 26),
        },
      ],
    },
    {
      threadId: "sim-airbnb-inquiry",
      propertyId: pick(1),
      channel: "airbnb",
      kind: "inquiry",
      title: "James Whitfield",
      guestName: "James",
      language: "en",
      messages: [
        {
          id: "sim-airbnb-inquiry-1",
          direction: "inbound",
          text: "Hi there! We're a family of four looking at the first week of March. Is the apartment suitable for a toddler, and is there parking nearby?",
          at: minutes(now, 34),
        },
      ],
    },
    {
      threadId: "sim-booking-late",
      propertyId: pick(1),
      channel: "booking_com",
      kind: "reservation",
      title: "Markus Huber",
      guestName: "Markus",
      language: "de",
      messages: [
        {
          id: "sim-booking-late-1",
          direction: "inbound",
          text: "Guten Abend, unser Flug hat Verspätung. Wir werden erst gegen 23:30 Uhr ankommen. Funktioniert der Self-Check-in auch so spät?",
          at: minutes(now, 95),
        },
        {
          id: "sim-booking-late-2",
          direction: "inbound",
          text: "Und noch eine Frage: Gibt es in der Nähe einen Parkplatz, den wir über Nacht nutzen können?",
          at: minutes(now, 93),
        },
      ],
    },
    {
      threadId: "sim-expedia-review",
      propertyId: pick(2),
      channel: "expedia",
      kind: "reservation",
      title: "Claire Dubois",
      guestName: "Claire",
      language: "fr",
      messages: [
        {
          id: "sim-expedia-review-1",
          direction: "inbound",
          text: "Bonjour, merci pour ce séjour magnifique ! Est-il possible de recevoir la facture au nom de notre entreprise ?",
          at: minutes(now, 60 * 50),
        },
      ],
    },
    {
      threadId: "sim-stay-long",
      propertyId: pick(2),
      channel: "stay_chat",
      kind: "reservation",
      title: "Sophie Lang",
      guestName: "Sophie",
      language: "de",
      messages: [
        {
          id: "sim-stay-long-1",
          direction: "inbound",
          text: "Liebes Team, vielen Dank für die schnelle Antwort gestern. Wir haben uns jetzt entschieden, einen Tag länger zu bleiben, falls das möglich ist. Außerdem würden wir gerne wissen, ob wir den Hund mitbringen dürfen – er ist klein, ruhig und stubenrein. Für den Abreisetag hätten wir noch die Frage nach einem späten Check-out, weil unser Zug erst um 16 Uhr fährt. Herzliche Grüße, Sophie",
          at: minutes(now, 60 * 3),
        },
      ],
    },
  ];
}
