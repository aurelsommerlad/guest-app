import { cx } from "../lib/cx";

/**
 * Glyphs of branded property names that the brand font (Josefin Sans) lacks,
 * mapped to a typographic substitute rendered with the font's own glyphs.
 */
const SUBSTITUTES: Readonly<Record<string, { glyph: string; className: string }>> = {
  // Greek capital lambda (U+039B) and Latin turned V (U+0245, as written in Apaleo).
  Λ: { glyph: "V", className: "glyph-flip-y" },
  Ʌ: { glyph: "V", className: "glyph-flip-y" },
};

export type PropertyNameProps = {
  /** Branded name exactly as written: HØV, HŪSLE, ΛLPILΛ, LÆKE. */
  name: string;
  /** Pronounceable name for assistive technology, e.g. "Alpila". Defaults to `name`. */
  spokenName?: string;
  className?: string;
};

/**
 * A property name in the brand typography – always Josefin Sans (`font-brand`), whatever
 * the surrounding text uses, because the Λ substitute is calibrated to its "V". Special
 * letters (Ø, Ū, Æ) come straight from the font. Screen readers get `spokenName`.
 */
export function PropertyName({ name, spokenName, className }: PropertyNameProps) {
  const characters = Array.from(name);
  const needsSubstitution = characters.some((character) => character in SUBSTITUTES);
  const accessibleName = spokenName ?? name;

  if (!needsSubstitution && accessibleName === name) {
    return <span className={cx("font-brand", className)}>{name}</span>;
  }

  return (
    <span className={cx("font-brand", className)}>
      <span aria-hidden>
        {characters.map((character, index) => {
          const substitute = SUBSTITUTES[character];
          return substitute ? (
            <span key={index} className={cx(substitute.className)}>
              {substitute.glyph}
            </span>
          ) : (
            character
          );
        })}
      </span>
      <span className="sr-only">{accessibleName}</span>
    </span>
  );
}
