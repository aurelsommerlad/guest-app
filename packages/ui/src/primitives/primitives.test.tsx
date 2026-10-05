import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Container } from "./Container";
import { Heading } from "./Heading";
import { Stack } from "./Stack";
import { Surface } from "./Surface";
import { Text } from "./Text";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Heading", () => {
  it("separates semantic level from visual variant", () => {
    const markup = html(
      <Heading level={2} variant="display">
        Hallo
      </Heading>,
    );
    expect(markup).toMatch(/^<h2 /);
    expect(markup).toContain("type-display");
  });

  it("derives a sensible default variant from the level", () => {
    expect(html(<Heading level={1}>A</Heading>)).toContain("type-display");
    expect(html(<Heading level={3}>A</Heading>)).toContain("type-title");
  });
});

describe("Text", () => {
  it("renders a paragraph with body style by default", () => {
    const markup = html(<Text>Lorem</Text>);
    expect(markup).toBe('<p class="type-body text-text">Lorem</p>');
  });

  it("supports semantic elements, variants and tones", () => {
    const markup = html(
      <Text as="span" variant="eyebrow" tone="muted">
        Check-out
      </Text>,
    );
    expect(markup).toBe('<span class="type-eyebrow text-text-muted">Check-out</span>');
  });
});

describe("Container", () => {
  it("applies width and responsive gutter", () => {
    const markup = html(<Container width="reading">x</Container>);
    expect(markup).toContain("max-w-reading");
    expect(markup).toContain("px-gutter md:px-gutter-md lg:px-gutter-lg");
  });

  it("can drop the gutter", () => {
    expect(html(<Container gutter={false}>x</Container>)).not.toContain("px-gutter");
  });
});

describe("Stack", () => {
  it("maps gap tokens and direction", () => {
    const markup = html(
      <Stack direction="horizontal" gap={2} align="center">
        <span>a</span>
      </Stack>,
    );
    expect(markup).toContain("flex flex-row gap-2 items-center");
  });

  it("renders lists semantically", () => {
    expect(
      html(
        <Stack as="ul">
          <li>a</li>
        </Stack>,
      ),
    ).toMatch(/^<ul /);
  });
});

describe("Surface", () => {
  it("is a flat, rounded card with 16px padding by default", () => {
    const markup = html(<Surface>x</Surface>);
    expect(markup).toContain("rounded-card bg-surface");
    expect(markup).toContain("p-4");
    expect(markup).not.toContain("shadow");
  });

  it("uses AA-compliant on-accent text on the sage accent surface", () => {
    expect(html(<Surface tone="accent">x</Surface>)).toContain("bg-surface-accent text-on-accent");
  });
});
