/** Calendar dates (YYYY-MM-DD) – shared by registration rules, templates and age checks. */
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = isoDate.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Full years between a birth date and a local date (both YYYY-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
