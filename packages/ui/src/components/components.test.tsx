import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Icon } from "../icons/Icon";
import { iconNames } from "../icons/paths";
import { Button, buttonStyles } from "./Button";
import { IconButton } from "./IconButton";

describe("Icon", () => {
  it("is hidden from assistive technology when decorative", () => {
    const markup = renderToStaticMarkup(<Icon name="calendar" />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("role=");
  });

  it("exposes an accessible name when labelled", () => {
    const markup = renderToStaticMarkup(<Icon name="bell" label="Benachrichtigungen" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Benachrichtigungen"');
  });

  it("uses the thin reference stroke and token sizes", () => {
    const markup = renderToStaticMarkup(<Icon name="bed" size="lg" />);
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('width="24"');
  });

  it("renders every icon in the set", () => {
    for (const name of iconNames) {
      expect(renderToStaticMarkup(<Icon name={name} />)).toMatch(/<(path|circle|rect|polygon)/);
    }
  });
});

describe("Button", () => {
  it("defaults to type=button to avoid accidental form submits", () => {
    expect(renderToStaticMarkup(<Button>Route planen</Button>)).toContain('type="button"');
  });

  it("uses the night call-to-action token for the filled variant, never sage", () => {
    const markup = renderToStaticMarkup(<Button>Route planen</Button>);
    expect(markup).toContain("bg-cta text-on-cta hover:bg-cta-hover");
    expect(markup).not.toContain("bg-action");
    expect(markup).toContain("min-h-11"); // 44px touch target
  });

  it("renders decorative icons next to the label", () => {
    const markup = renderToStaticMarkup(
      <Button variant="link" iconEnd="arrow-right">
        Details ansehen
      </Button>,
    );
    expect(markup).toContain("<span>Details ansehen</span>");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("exposes styles for links without a router dependency", () => {
    expect(buttonStyles("secondary", "w-full")).toContain("border-border");
    expect(buttonStyles("secondary", "w-full")).toMatch(/w-full$/);
  });
});

describe("IconButton", () => {
  it("requires and renders an accessible name", () => {
    const markup = renderToStaticMarkup(<IconButton icon="arrow-right" label="Guide öffnen" />);
    expect(markup).toContain('aria-label="Guide öffnen"');
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("before:size-touch"); // 44px hit area
  });
});
