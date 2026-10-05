import { Container, Heading, Icon, IconButton, Stack, Surface, Text } from "@up/ui";

import extras from "../_assets/placeholder-extras.webp";
import interior from "../_assets/placeholder-interior.webp";
import landscape from "../_assets/placeholder-landscape.webp";
import { ImageCardSample } from "./ImageCardSample";

/**
 * Composition test for responsive behaviour: primitives arranged in the rhythm
 * of the PRIMARY DESIGN REFERENCE. This is a specimen inside the Design Lab –
 * deliberately not the STAY page (no data, no final components, no navigation).
 */
export function Specimen() {
  return (
    <Container as="div" width="content" className="pt-2 pb-12 lg:pt-10">
      <header className="flex min-h-11 items-center justify-between">
        <Text as="span" variant="brand">
          HØV <span className="px-1 text-text-muted">·</span>{" "}
          <span className="text-text-muted">Altusried</span>
        </Text>
        <IconButton icon="bell" label="Benachrichtigungen" variant="ghost" />
      </header>

      <div className="mt-6 grid gap-5 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-12">
        <Stack gap={3} className="lg:col-span-7">
          <Heading level={1}>
            Hallo Laura,
            <br />
            schön, dass Du da bist.
          </Heading>
          <Text variant="lead" tone="muted" className="max-w-64 text-balance lg:max-w-reading">
            Wir wünschen Dir einen wunderbaren Aufenthalt.
          </Text>
        </Stack>

        <div className="grid grid-cols-2 gap-2 lg:col-span-5">
          <Surface className="flex flex-col gap-4">
            <Stack direction="horizontal" gap={4} align="center">
              <Icon name="calendar" size="sm" />
              <Text as="span" variant="eyebrow">
                Check-out
              </Text>
            </Stack>
            <Stack gap={1}>
              <Text as="span" variant="figure">
                10:00
              </Text>
              <Text as="span" variant="small" tone="muted">
                31. August 2026
              </Text>
            </Stack>
          </Surface>
          <Surface tone="accent" className="flex flex-col gap-4">
            <Stack direction="horizontal" gap={4} align="center">
              <Icon name="home" size="sm" />
              <Text as="span" variant="eyebrow" tone="inherit">
                Apartment
              </Text>
            </Stack>
            <Stack gap={1}>
              <Text as="span" variant="figure" tone="inherit">
                ROS
              </Text>
              <Text
                as="span"
                variant="small"
                tone="inherit"
                className="inline-flex items-center gap-2"
              >
                Details ansehen <Icon name="arrow-right" size="sm" />
              </Text>
            </Stack>
          </Surface>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 lg:mt-12 lg:grid-cols-3 lg:gap-3">
        <div className="md:col-span-2 lg:col-span-1">
          <ImageCardSample
            image={interior}
            ratio="feature"
            title="Alles für Deinen Aufenthalt"
            subtitle="WLAN, Geräte, Haus & Apartment"
          />
        </div>
        <ImageCardSample
          image={extras}
          title="Extras"
          subtitle="Mach Deinen Aufenthalt noch schöner"
        />
        <ImageCardSample
          image={landscape}
          title="Allgäu entdecken"
          subtitle="Unsere Lieblingsplätze für Dich"
        />
      </div>
    </Container>
  );
}
