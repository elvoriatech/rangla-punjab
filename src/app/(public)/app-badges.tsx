import type React from "react";

/**
 * The two store badges in the public menu's "Get the app" section.
 *
 * Deliberately OUR OWN artwork, not Apple's or Google's. Both companies
 * ship official badge images under a licence that says, roughly: use our
 * file, unmodified, at our minimum size, and don't re-draw it. Shipping a
 * copy of either PNG into this repo would put a redistribution question
 * on a multi-tenant product, and re-drawing their logos pixel-for-pixel
 * would be worse. So these are brand-NEUTRAL: the familiar pill shape and
 * the familiar two-line wording, drawn with plain geometry and a generic
 * glyph (a download arrow, a play triangle) that belongs to nobody.
 *
 * Inline SVG rather than <img>, because:
 *   - it inherits `currentColor`, so one badge works on every menu theme
 *     (the public page has five, from cream to near-black) without us
 *     shipping a light and a dark file per store;
 *   - it costs no extra request on a page whose whole budget is one QR
 *     scan on restaurant wifi;
 *   - it scales crisply, which a 2x PNG at 160px wide does not.
 *
 * Both are `aria-hidden`: the anchor around them carries the accessible
 * name (`t.app.storeAria(...)`), so a screen reader hears one link, not a
 * link plus two stray text runs.
 */

interface BadgeProps {
  /** Small first line — "Download on the" / "Get it on". Translated. */
  topLine: string;
  /** Store name — "App Store" / "Google Play". A brand name: never
   *  translated, in any locale. */
  storeName: string;
  className?: string;
}

/** Shared shell: the pill, its hairline border and the two text lines.
 *  Sized in the viewBox so the caller only ever sets a width. */
function Badge({
  topLine,
  storeName,
  className,
  children,
}: BadgeProps & { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 180 54"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect
        x="0.75"
        y="0.75"
        width="178.5"
        height="52.5"
        rx="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      <g fill="currentColor">{children}</g>
      {/* Text sits left of centre with the glyph at x≈14–44; the start of
          the text block is the same on both badges so a stacked pair lines
          up. `textLength` is not set: a long German first line is allowed
          to be smaller rather than squashed. */}
      <text x="54" y="22" fontSize="10" fill="currentColor" fillOpacity="0.85">
        {topLine}
      </text>
      <text x="54" y="39" fontSize="16" fontWeight="600" fill="currentColor">
        {storeName}
      </text>
    </svg>
  );
}

/**
 * App Store badge. Glyph: a download arrow dropping into a tray — the
 * universal "get this onto my device" mark, and not Apple's logo.
 */
export function AppStoreBadge(props: BadgeProps): React.ReactElement {
  return (
    <Badge {...props}>
      <path d="M29 13v16m0 0-6-6m6 6 6-6" stroke="currentColor" strokeWidth="2.4" fill="none" />
      <path
        d="M18 33v5a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-5"
        stroke="currentColor"
        strokeWidth="2.4"
        fill="none"
      />
    </Badge>
  );
}

/**
 * Google Play badge. Glyph: a plain outlined play triangle — the shape
 * "play" has had since cassette decks, with none of Play's four-colour
 * gradient, which is the part Google actually owns.
 */
export function GooglePlayBadge(props: BadgeProps): React.ReactElement {
  return (
    <Badge {...props}>
      <path
        d="M21 13.5 39 27 21 40.5Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
        fill="none"
      />
    </Badge>
  );
}
