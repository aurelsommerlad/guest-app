"use client";

import { FilterBar } from "@up/ui";
import { useState } from "react";

const filters = [
  { id: "all", label: "Alle" },
  { id: "food-drink", label: "Essen & Trinken" },
  { id: "nature", label: "Natur & Ausflüge" },
  { id: "activities", label: "Aktivitäten" },
  { id: "wellness", label: "Baden & Wellness" },
  { id: "shopping", label: "Einkaufen" },
  { id: "sights", label: "Sehenswertes" },
] as const;

/** Interactive FilterBar example for the Design Lab. */
export function ExploreFilterDemo() {
  const [value, setValue] = useState<(typeof filters)[number]["id"]>("all");
  return (
    <FilterBar items={filters} value={value} onChange={setValue} label="Kategorien (Beispiel)" />
  );
}
