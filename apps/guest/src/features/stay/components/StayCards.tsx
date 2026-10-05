import { EditorialImageCard } from "@up/ui";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { type StayCard } from "../model";

/** Large photographic navigation cards (guide, extras, explore). */
export async function StayCards({ cards }: { cards: readonly StayCard[] }) {
  const t = await getTranslations("stay");
  return (
    <section aria-labelledby="stay-cards-heading">
      <h2 id="stay-cards-heading" className="sr-only">
        {t("cardsHeading")}
      </h2>
      <ul className="grid gap-2 lg:grid-cols-3 lg:gap-3">
        {cards.map((card, index) => (
          <li key={card.id}>
            <EditorialImageCard
              href={card.href}
              title={card.title}
              subtitle={card.subtitle}
              ratio={index === 0 ? "feature" : "standard"}
              headingLevel={3}
              linkComponent={Link}
              media={
                <Image
                  src={card.image.src}
                  // Decorative: the card's title already names the destination.
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 340px, (min-width: 768px) 640px, 100vw"
                  preload={index === 0}
                  className="object-cover"
                  style={card.image.focus ? { objectPosition: card.image.focus } : undefined}
                />
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
