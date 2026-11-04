import { Heading, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";
import { type ReactNode } from "react";

/** Personal greeting – the page's main heading. */
export async function Greeting({
  firstName,
  upcoming = false,
}: {
  firstName?: string;
  /** Before the arrival day: "schön, dass Du bald bei uns bist." */
  upcoming?: boolean;
}) {
  const t = await getTranslations("stay");
  const br = () => <br />;
  // Second line as its own balanced block: the longer pre-arrival sentence breaks evenly
  // ("schön, dass Du bald / bei uns bist.") instead of leaving one word alone.
  const line = (chunks: ReactNode) => <span className="block text-balance">{chunks}</span>;
  return (
    <div className="flex flex-col gap-2.5">
      <Heading level={1} variant={upcoming ? "display-compact" : "display"}>
        {upcoming
          ? firstName
            ? t.rich("greetingUpcoming", { firstName, line })
            : t.rich("greetingUpcomingWithoutName", { line })
          : firstName
            ? t.rich("greeting", { firstName, br })
            : t.rich("greetingWithoutName", { br })}
      </Heading>
      {/* The short personal sub-line of the original visualisation – before and during the stay. */}
      <Text variant="lead" tone="muted" className="max-w-64 text-balance lg:max-w-reading">
        {t("subline")}
      </Text>
    </div>
  );
}
