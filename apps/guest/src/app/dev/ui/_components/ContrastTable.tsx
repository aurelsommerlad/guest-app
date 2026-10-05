"use client";

import { contrastPairs, Text } from "@up/ui";

import { contrastRatio, parseColor, wcagRating } from "../_lib/contrast";
import { useResolvedColors } from "./use-css-variable";

export function ContrastTable() {
  const values = useResolvedColors([...new Set(contrastPairs.flatMap((p) => [p.fg, p.bg]))]);

  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {contrastPairs.map((pair) => {
        const fg = parseColor(values[pair.fg] ?? "");
        const bg = parseColor(values[pair.bg] ?? "");
        const ratio = fg && bg ? contrastRatio(fg, bg) : null;
        const rating = ratio ? wcagRating(ratio) : null;
        return (
          <li
            key={`${pair.fg}-${pair.bg}`}
            className="flex items-center gap-4 rounded-card p-4"
            style={{ background: `var(${pair.bg})`, color: `var(${pair.fg})` }}
          >
            <span className="type-figure w-20 shrink-0 tabular-nums">
              {ratio ? ratio.toFixed(1) : "…"}
            </span>
            <span className="min-w-0">
              <span className="type-small block">{pair.usage}</span>
              <span className="type-eyebrow block">
                {rating}
                {pair.largeTextOnly ? " · nur große Schrift" : ""}
              </span>
            </span>
          </li>
        );
      })}
      <li className="md:col-span-2">
        <Text variant="caption" tone="muted">
          WCAG 2.2: AA verlangt 4,5 : 1 für normalen Text und 3 : 1 für große Schrift (ab 24 px bzw.
          18,7 px fett) sowie für UI-Elemente.
        </Text>
      </li>
    </ul>
  );
}
