import { Callout, Icon, type IconName } from "@up/ui";
import Image from "next/image";

import { Link } from "../../../i18n/navigation";
import { type ResolvedBlock } from "../model";

/** Renders guide content blocks with the editorial rhythm of the guest app. */
export function GuideBlocks({ blocks }: { blocks: readonly ResolvedBlock[] }) {
  return (
    <div className="flex flex-col">
      {blocks.map((block) => (
        <GuideBlock key={block.id} block={block} />
      ))}
    </div>
  );
}

function GuideBlock({ block }: { block: ResolvedBlock }) {
  switch (block.type) {
    case "heading":
      return <h2 className="type-title mt-8 text-text first:mt-0">{block.text}</h2>;

    case "paragraph":
      return <p className="type-body mt-2 text-text first:mt-0">{block.text}</p>;

    case "list": {
      const ListTag = block.style === "steps" ? "ol" : "ul";
      return (
        <ListTag className="mt-6 flex flex-col gap-3 border-y border-border py-5 first:mt-0">
          {block.items.map((item, index) => (
            <li key={index} className="type-body flex gap-4 text-text">
              {block.style === "steps" ? (
                <span
                  aria-hidden
                  className="type-eyebrow w-4 shrink-0 pt-1 text-text-muted tabular-nums"
                >
                  {index + 1}
                </span>
              ) : (
                <span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-text-muted" />
              )}
              <span>{item}</span>
            </li>
          ))}
        </ListTag>
      );
    }

    case "callout":
      return (
        <Callout title={block.title} className="mt-8 first:mt-0">
          {block.text}
        </Callout>
      );

    case "image":
      return (
        <figure className="mt-8 first:mt-0">
          <Image
            src={block.image.src}
            width={block.image.width}
            height={block.image.height}
            alt={block.image.alt}
            sizes="(min-width: 768px) 640px, 100vw"
            placeholder={block.image.blurDataUrl ? "blur" : "empty"}
            blurDataURL={block.image.blurDataUrl}
            className="w-full rounded-card"
          />
          {block.caption && (
            <figcaption className="type-caption mt-2 text-text-muted">{block.caption}</figcaption>
          )}
        </figure>
      );

    case "link": {
      const external = /^https?:\/\//.test(block.href);
      const className =
        "type-small mt-4 inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-action underline-offset-4 hover:underline first:mt-0";
      const content = (
        <>
          {block.label}
          <Icon name="arrow-right" size="sm" />
        </>
      );
      return external ? (
        <a href={block.href} target="_blank" rel="noopener noreferrer" className={className}>
          {content}
        </a>
      ) : (
        <Link href={block.href} className={className}>
          {content}
        </Link>
      );
    }

    case "action":
      return <ActionRow block={block} />;
  }
}

const actionConfig: Record<
  "phone" | "email" | "map",
  { icon: IconName; href: (value: string) => string }
> = {
  phone: { icon: "phone", href: (value) => `tel:${value.replace(/[^\d+]/g, "")}` },
  email: { icon: "mail", href: (value) => `mailto:${value}` },
  map: {
    icon: "map-pin",
    href: (value) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`,
  },
};

/** Contact / action row (call, write, open map) – same calm row style as the guide list. */
function ActionRow({ block }: { block: Extract<ResolvedBlock, { type: "action" }> }) {
  const config = actionConfig[block.action];
  const external = block.action === "map";
  return (
    <a
      href={config.href(block.value)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="group mt-6 flex min-h-16 items-center gap-4 border-y border-border py-4 first:mt-0"
    >
      <Icon name={config.icon} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="type-title block text-text">{block.label}</span>
        <span className="type-caption block text-text-muted">{block.value}</span>
      </span>
      <Icon name="chevron-right" size="md" className="text-text-muted" />
    </a>
  );
}
