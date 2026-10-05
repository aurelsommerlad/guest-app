import { Container, Heading, Stack, Text } from "@up/ui";
import type { ReactNode } from "react";

export function LabSection({
  id,
  index,
  title,
  intro,
  children,
}: {
  id: string;
  index: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-8 border-t border-border py-12 lg:py-20"
    >
      <Container width="wide">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <Stack gap={3} className="lg:col-span-4">
            <Text variant="eyebrow" tone="muted">
              {index}
            </Text>
            <Heading level={2} variant="title-lg" id={`${id}-title`}>
              {title}
            </Heading>
            {intro && (
              <Text variant="lead" tone="muted" className="max-w-reading">
                {intro}
              </Text>
            )}
          </Stack>
          <div className="lg:col-span-8">{children}</div>
        </div>
      </Container>
    </section>
  );
}
