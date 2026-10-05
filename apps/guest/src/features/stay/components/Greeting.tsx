import { Heading, Text } from "@up/ui";
import { getTranslations } from "next-intl/server";

/** Personal greeting – the page's main heading. */
export async function Greeting({ firstName }: { firstName?: string }) {
  const t = await getTranslations("stay");
  const br = () => <br />;
  return (
    <div className="flex flex-col gap-3">
      <Heading level={1}>
        {firstName ? t.rich("greeting", { firstName, br }) : t.rich("greetingWithoutName", { br })}
      </Heading>
      <Text variant="lead" tone="muted" className="max-w-64 text-balance lg:max-w-reading">
        {t("subline")}
      </Text>
    </div>
  );
}
