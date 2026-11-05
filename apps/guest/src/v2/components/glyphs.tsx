/** Thin line arrow of the V2 reference (photo cards, buttons). Decorative. */
export function V2Arrow({ className = "v2-arrow" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 18 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M0.75 5h16.5M12.75 0.75 17.25 5l-4.5 4.25" />
    </svg>
  );
}

/**
 * UP monogram (provisional, drawn after the V2 reference until the official logo exists as
 * SVG – then only this component changes). Decorative: the link carries the name.
 */
export function V2Monogram() {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 74 42"
      fill="currentColor"
      className="v2-monogram"
    >
      {/* U: heavy left stem with a top serif, hairline bowl rising into the shared stem */}
      <path d="M1 1.2h15.2v1.4l-3.1.4v22.6c0 8.2 4.8 13 11.7 13 5.1 0 8.9-2.4 11-6.6l1.2.5c-2.5 5.6-7 8.6-13.2 8.6-9.5 0-15.1-6.1-15.1-15.4V3l-7.7-.4Z" />
      {/* P: stem with foot serif, bowl to the right */}
      <path d="M33.2 1.2h12.3c10.4 0 16.1 4.6 16.1 11.6 0 7.4-6 11.9-15.9 11.9h-4.4v-1.5h4.1c6.8 0 10.4-3.8 10.4-10.3 0-6.3-3.6-9.9-10.5-9.9h-4v35.6l3.6.5v1.4H32.5V39l3.5-.5V3l-2.8-.4Z" />
    </svg>
  );
}
