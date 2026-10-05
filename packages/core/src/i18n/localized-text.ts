/**
 * Translatable content stored with the data (guide articles, recommendations,
 * card titles …) – as opposed to UI strings, which live in the app's messages.
 * Shape matches the planned `jsonb` columns: { "de": "…", "en": "…" }.
 */
export type LocalizedText = Readonly<Partial<Record<string, string>>>;

/**
 * Returns the text for `locale`, falling back to `fallbackLocale`, then to any
 * available translation. Returns an empty string only if no text exists at all.
 */
export function resolveLocalizedText(
  text: LocalizedText,
  locale: string,
  fallbackLocale: string,
): string {
  return (
    text[locale] ??
    text[fallbackLocale] ??
    Object.values(text).find((value) => value !== undefined) ??
    ""
  );
}
