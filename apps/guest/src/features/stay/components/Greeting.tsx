import { Heading, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";

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
  return (
    <div className="flex flex-col gap-3">
      <Heading level={1}>
        {upcoming
          ? firstName
            ? t.rich("greetingUpcoming", { firstName, br })
            : t.rich("greetingUpcomingWithoutName", { br })
          : firstName
            ? t.rich("greeting", { firstName, br })
            : t.rich("greetingWithoutName", { br })}
      </Heading>
      {/* Before arrival the check-in card speaks instead – keeps the screen compact. */}
      {!upcoming && (
        <Text variant="lead" tone="muted" className="max-w-64 text-balance lg:max-w-reading">
          {t("subline")}
        </Text>
      )}
    </div>
  );
}
