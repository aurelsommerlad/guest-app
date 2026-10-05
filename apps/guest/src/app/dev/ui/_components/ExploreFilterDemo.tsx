"use client";

import { FilterBar } from "@up/ui";
import { useState } from "react";

const filters = [
  { id: "all", label: "Alle" },
  { id: "food-drink", label: "Essen & Trinken" },
  { id: "nature", label: "Natur" },
  { id: "active", label: "Aktiv" },
  { id: "culture", label: "Kultur" },
  { id: "family", label: "Familie" },
] as const;

/** Interactive FilterBar example for the Design Lab. */
export function ExploreFilterDemo() {
  const [value, setValue] = useState<(typeof filters)[number]["id"]>("all");
  return (
    <FilterBar items={filters} value={value} onChange={setValue} label="Kategorien (Beispiel)" />
  );
}
