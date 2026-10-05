import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BottomNavigation } from "./BottomNavigation";
import { EditorialImageCard } from "./EditorialImageCard";
import { Callout } from "./Callout";
import { InfoTile } from "./InfoTile";
import { LinkList } from "./LinkList";
import { PropertyName } from "./PropertyName";
import { type LinkComponentProps } from "./link";

const items = [
  { id: "guide", href: "/de/guide", label: "Guide", icon: "map" },
  { id: "stay", href: "/de/stay", label: "Stay", icon: "bed" },
  { id: "explore", href: "/de/explore", label: "Explore", icon: "compass" },
] as const;

describe("InfoTile", () => {
  it("renders a description-list group with label, value and meta", () => {
    const markup = renderToStaticMarkup(
      <dl>
        <InfoTile icon="calendar" label="Check-out" value="10:00" meta="31. August 2026" />
      </dl>,
    );
    expect(markup).toMatch(/<dt[^>]*>.*Check-out.*<\/dt>/);
    expect(markup).toMatch(/<dd[^>]*>.*10:00.*31\. August 2026.*<\/dd>/);
    expect(markup).toContain("type-figure");
  });

  it("uses on-accent text on the sage tone", () => {
    const markup = renderToStaticMarkup(
      <dl>
        <InfoTile icon="home" label="Apartment" value="ROS" tone="accent" />
      </dl>,
    );
    expect(markup).toContain("bg-surface-accent text-on-accent");
  });

  it("supports short text values", () => {
    const markup = renderToStaticMarkup(
      <dl>
        <InfoTile icon="check" label="Online-Check-in" value="Jetzt erledigen" valueStyle="text" />
      </dl>,
    );
    expect(markup).toContain("type-title");
  });
});

describe("EditorialImageCard", () => {
  it("is a single link with a heading and decorative arrow", () => {
    const markup = renderToStaticMarkup(
      <EditorialImageCard
        href="/de/guide"
        title="Alles für Deinen Aufenthalt"
        subtitle="WLAN, Geräte, Haus & Apartment"
        media={<span data-media />}
      />,
    );
    expect(markup).toMatch(/^<a href="\/de\/guide"/);
    expect(markup).toContain("<h2");
    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("aspect-photo");
  });

  it("renders through a custom link component", () => {
    const CustomLink = ({ href, children, className }: LinkComponentProps) => (
      <a href={`/x${href}`} className={className} data-custom>
        {children}
      </a>
    );
    const markup = renderToStaticMarkup(
      <EditorialImageCard
        href="/extras"
        title="Extras"
        media={null}
        linkComponent={CustomLink}
        ratio="feature"
      />,
    );
    expect(markup).toContain('href="/x/extras"');
    expect(markup).toContain("data-custom");
    expect(markup).toContain("aspect-photo-feature");
  });
});

describe("BottomNavigation", () => {
  it("is a labelled navigation landmark with all items", () => {
    const markup = renderToStaticMarkup(
      <BottomNavigation items={items} activeId="stay" label="Hauptnavigation" />,
    );
    expect(markup).toMatch(/^<nav aria-label="Hauptnavigation"/);
    expect(markup.match(/<li/g)).toHaveLength(3);
    expect(markup).toContain("safe-bottom");
  });

  it("marks only the active item, wherever it is", () => {
    for (const active of ["guide", "stay", "explore"]) {
      const markup = renderToStaticMarkup(
        <BottomNavigation items={items} activeId={active} label="Nav" />,
      );
      expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
      expect(markup.match(/bg-surface-inverse/g)).toHaveLength(1);
      expect(markup).toMatch(new RegExp(`href="/de/${active}" aria-current="page"`));
    }
  });
});

describe("PropertyName", () => {
  it("renders Latin special letters directly from the font", () => {
    for (const name of ["HØV", "HŪSLE", "LÆKE"]) {
      expect(renderToStaticMarkup(<PropertyName name={name} />)).toBe(`<span>${name}</span>`);
    }
  });

  it("draws Λ from a mirrored V and gives screen readers the spoken name", () => {
    const markup = renderToStaticMarkup(<PropertyName name="ΛLPILΛ" spokenName="Alpila" />);
    expect(markup.match(/<span class="glyph-flip-y">V<\/span>/g)).toHaveLength(2);
    expect(markup).toContain('<span aria-hidden="true">');
    expect(markup).toContain('<span class="sr-only">Alpila</span>');
    expect(markup).not.toContain("Λ");
  });

  it("also draws the Latin turned V (Ʌ, U+0245) used in Apaleo", () => {
    const markup = renderToStaticMarkup(<PropertyName name="ɅLPILɅ" spokenName="Alpila" />);
    expect(markup.match(/glyph-flip-y/g)).toHaveLength(2);
    expect(markup).not.toContain("Ʌ");
  });

  it("uses the spoken name for assistive technology when it differs", () => {
    const markup = renderToStaticMarkup(<PropertyName name="HØV" spokenName="Höv" />);
    expect(markup).toContain('<span class="sr-only">Höv</span>');
  });
});

describe("LinkList", () => {
  const listItems = [
    {
      id: "arrival",
      href: "/de/guide/ankunft-parken",
      title: "Ankunft & Parken",
      description: "Anreise, Parken, Self-Check-in",
      icon: "car",
    },
    { id: "wifi", href: "/de/guide/wlan", title: "WLAN", icon: "wifi" },
  ] as const;

  it("renders one link per item with a heading and decorative icons", () => {
    const markup = renderToStaticMarkup(<LinkList items={listItems} />);
    expect(markup.match(/<li/g)).toHaveLength(2);
    expect(markup.match(/<a /g)).toHaveLength(2);
    expect(markup).toContain('<h2 class="type-title text-text">Ankunft &amp; Parken</h2>');
    expect(markup).toContain("Anreise, Parken, Self-Check-in");
    expect(markup).not.toContain('role="img"');
  });

  it("uses hairlines instead of cards", () => {
    const markup = renderToStaticMarkup(<LinkList items={listItems} headingLevel={3} />);
    expect(markup).toContain("border-b border-border");
    expect(markup).not.toContain("shadow");
    expect(markup).toContain("<h3");
  });
});

describe("Callout", () => {
  it("is a complementary hint with optional title", () => {
    const markup = renderToStaticMarkup(
      <Callout title="Gut zu wissen">Folge der Beschilderung.</Callout>,
    );
    expect(markup).toMatch(/^<aside/);
    expect(markup).toContain("Gut zu wissen");
    expect(markup).toContain("bg-surface");
  });
});
