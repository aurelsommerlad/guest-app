import { IconButton, Stack, Text } from "@up/ui";
import Image, { type StaticImageData } from "next/image";

/**
 * Lab sample of "photography + text" built from primitives.
 * NOT the final HeroCard/ImageCard component (planned for a later phase).
 */
export function ImageCardSample({
  image,
  title,
  subtitle,
  ratio = "standard",
  sizes = "(min-width: 1024px) 33vw, 100vw",
}: {
  image: StaticImageData;
  title: string;
  subtitle: string;
  /** Mobile ratio from the reference; on desktop all cards share 4:3. */
  ratio?: "feature" | "standard" | "portrait";
  sizes?: string;
}) {
  const aspect = {
    feature: "aspect-photo-feature lg:aspect-landscape",
    standard: "aspect-photo lg:aspect-landscape",
    portrait: "aspect-portrait",
  }[ratio];
  return (
    <article className={`relative isolate overflow-hidden rounded-card bg-surface ${aspect}`}>
      <Image
        src={image}
        alt=""
        fill
        sizes={sizes}
        className="-z-10 object-cover"
        placeholder="blur"
      />
      <div aria-hidden className="overlay-image absolute inset-0 -z-10" />
      <div className="flex h-full items-end justify-between gap-4 px-4 pt-4 pb-3">
        <Stack gap={0}>
          <h3 className="type-title text-text-inverse">{title}</h3>
          <Text variant="small" tone="inverse" className="max-w-52 text-balance">
            {subtitle}
          </Text>
        </Stack>
        <IconButton icon="arrow-right" label={`${title} öffnen`} className="mb-1" />
      </div>
    </article>
  );
}
