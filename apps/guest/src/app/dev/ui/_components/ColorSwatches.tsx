"use client";

import { type ColorToken, Stack, Text } from "@up/ui";

import { parseColor, toHex } from "../_lib/contrast";
import { useResolvedColors } from "./use-css-variable";

export function ColorSwatches({ tokens }: { tokens: readonly ColorToken[] }) {
  const values = useResolvedColors(tokens.map((t) => t.variable));

  return (
    <ul className="grid grid-cols-2 gap-x-2 gap-y-6 md:grid-cols-4 md:gap-x-3">
      {tokens.map((token) => {
        const rgb = values[token.variable] ? parseColor(values[token.variable] ?? "") : null;
        return (
          <li key={token.variable}>
            <Stack gap={3}>
              <div
                className="aspect-landscape rounded-card border border-border"
                style={{ background: `var(${token.variable})` }}
              />
              <Stack gap={1}>
                <Text variant="eyebrow">{token.name}</Text>
                <Text variant="small" tone="muted">
                  {rgb ? toHex(rgb) : "…"}
                </Text>
                <Text variant="caption" tone="muted">
                  {token.role}
                </Text>
              </Stack>
            </Stack>
          </li>
        );
      })}
    </ul>
  );
}

export function SemanticColorList({ tokens }: { tokens: readonly ColorToken[] }) {
  const values = useResolvedColors(tokens.map((t) => t.variable));

  return (
    <ul className="divide-y divide-border border-y border-border">
      {tokens.map((token) => {
        const rgb = values[token.variable] ? parseColor(values[token.variable] ?? "") : null;
        return (
          <li key={token.variable} className="flex items-center gap-4 py-3">
            <span
              aria-hidden
              className="size-8 shrink-0 rounded-full border border-border"
              style={{ background: `var(${token.variable})` }}
            />
            <div className="min-w-0 flex-1">
              <Text variant="small">{token.name}</Text>
              <Text variant="caption" tone="muted">
                {token.role}
              </Text>
            </div>
            <Text as="span" variant="caption" tone="muted" className="tabular-nums">
              {rgb ? toHex(rgb) : "…"}
            </Text>
          </li>
        );
      })}
    </ul>
  );
}
