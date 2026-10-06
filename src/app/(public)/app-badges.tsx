import type React from "react";

/**
 * The store badges in the public menu's "Get the app" section and on
 * /app/download.
 *
 * Drawn in the stores' own look — black pill, white type, the Apple logo,
 * Google Play's four-colour triangle — because that is what guests have
 * learned to tap (owner, 2026-10-06: "should have these images"). An
 * earlier version used brand-neutral glyphs; next to real badges on every
 * other site they read as "not the real app".
 *
 * Usage rules both stores attach to their badges, which the callers keep:
 *   - a store badge links ONLY to that store's listing — the APK, hosted
 *     by the venue, gets the Android badge, never the Google Play one;
 *   - at least 40 px tall on screen (callers size them 40 × 135);
 *   - the store name is a brand and is never translated; the small line
 *     above it is the localised wording each store publishes.
 *
 * Inline SVG rather than <img>: no extra request on a page whose budget
 * is one QR scan on restaurant wifi, and crisp on every pixel density.
 * The black fill carries its own contrast, so the badge reads on every
 * menu theme, cream to near-black (the grey hairline keeps its edge on the
 * dark ones).
 *
 * Every badge is `aria-hidden`: the anchor around it carries the
 * accessible name (`t.app.storeAria(...)`), so a screen reader hears one
 * link, not a link plus two stray text runs.
 */

interface BadgeProps {
  /** Small first line — "Download on the" / "Get it on". Translated. */
  topLine: string;
  /** Store name — "App Store" / "Google Play". A brand name: never
   *  translated, in any locale. */
  storeName: string;
  className?: string;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Shared shell: the black pill, its grey hairline and the two text lines.
 *  Sized in the viewBox so the caller only ever sets a box. */
function Badge({
  topLine,
  storeName,
  className,
  children,
}: BadgeProps & { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 135 40"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="0.5" y="0.5" width="134" height="39" rx="6.5" fill="#000" stroke="#a6a6a6" />
      {children}
      {/* No `textLength`: a long first line ("Herunterladen für") may run
          smaller rather than be squashed. */}
      <text x="40" y="15" fontSize="7.5" fill="#fff" fontFamily={FONT}>
        {topLine}
      </text>
      <text
        x="40"
        y="30.5"
        fontSize="14.5"
        fontWeight="600"
        letterSpacing="-0.2"
        fill="#fff"
        fontFamily={FONT}
      >
        {storeName}
      </text>
    </svg>
  );
}

/** App Store badge — the Apple logo, white on black. */
export function AppStoreBadge(props: BadgeProps): React.ReactElement {
  return (
    <Badge {...props}>
      <path
        transform="translate(9.5 7.5) scale(1.05)"
        fill="#fff"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </Badge>
  );
}

/** Google Play badge — the four-colour play triangle. Google prints the
 *  small line in capitals ("GET IT ON", "JETZT BEI"). */
export function GooglePlayBadge({ topLine, ...rest }: BadgeProps): React.ReactElement {
  return (
    <Badge topLine={topLine.toUpperCase()} {...rest}>
      <g transform="translate(10 8)">
        {/* Four wedges meeting at (11,12): blue left, green top, red
            bottom, yellow at the tip. */}
        <path
          fill="#00a0ff"
          d="M1.2 .6 11 12 1.2 23.4A1.6 1.6 0 0 1 .5 22V2A1.6 1.6 0 0 1 1.2.6Z"
        />
        <path fill="#00d26a" d="M1.2.6 15.3 7.7 11 12Z" />
        <path fill="#ff3a44" d="M1.2 23.4 11 12l4.3 4.3Z" />
        <path fill="#ffd400" d="m15.3 7.7 4.4 2.5c1.4.8 1.4 2.8 0 3.6l-4.4 2.5L11 12Z" />
      </g>
    </Badge>
  );
}

/**
 * Direct-download (APK) badge — the venue hosts this file itself, so it
 * says "Android", never "Google Play". The robot is Google's CC BY-licensed
 * Android mascot, free to use, in its own green.
 */
export function AndroidBadge(props: BadgeProps): React.ReactElement {
  return (
    <Badge {...props}>
      <g transform="translate(8 9)">
        {/* Head with the eyes cut out (evenodd), so they show the black
            of the pill behind. */}
        <path
          fill="#3ddc84"
          fillRule="evenodd"
          d="M2 20a11 11 0 0 1 22 0Z M10.3 15.4a1.5 1.5 0 1 0-3 0a1.5 1.5 0 1 0 3 0Z M18.7 15.4a1.5 1.5 0 1 0-3 0a1.5 1.5 0 1 0 3 0Z"
        />
        <path
          d="M7.6 10.6 5 6.6m13.4 4 2.6-4"
          stroke="#3ddc84"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>
    </Badge>
  );
}
