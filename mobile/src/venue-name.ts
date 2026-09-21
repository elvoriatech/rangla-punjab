/**
 * A venue name that wants to be set on two lines.
 *
 * "Rangla Punjab Restaurant · Konstanz" is ONE string in the database —
 * one `venues.name`, one row, one thing the owner edits — but wherever
 * the app SETS it as a heading it reads as an identity (the restaurant)
 * over a locality (the town), the way a letterhead sets them. Rather
 * than a second column every import, export and settings form would
 * have to learn about, the SEPARATOR carries the line break: the owner
 * types " · " and every heading splits on it.
 *
 * This mirrors `src/lib/venue-name.ts` in the web app deliberately —
 * the two surfaces must break the same name in the same place, and the
 * app cannot import from the web tree.
 *
 * The separator is `space U+00B7 space` — a middle dot, not a hyphen and
 * not a bullet: the character a German typographer reaches for between a
 * name and a place, still correct when a surface prints the name inline
 * (a share message, an `accessibilityLabel`, a receipt), and rare enough
 * inside a real restaurant name that a false split is close to
 * impossible. A bare "·" with no spaces is deliberately NOT a separator:
 * "Café·Bar" is one word to whoever typed it.
 *
 * Only the FIRST separator splits. "A · B · C" is "A" over "B · C",
 * because two lines is the whole feature — a third line is a different
 * design, not a longer version of this one.
 *
 * INLINE surfaces keep the whole string: share messages, Stripe's
 * `merchantDisplayName`, alt texts, printed receipts. Splitting is for
 * headings only.
 */

/** Space, U+00B7 MIDDLE DOT, space. */
export const VENUE_NAME_SEPARATOR = " · ";

export interface VenueNameLines {
  line1: string;
  line2: string | null;
}

/**
 * Split a venue name into its display lines.
 *
 * No separator, or nothing after it, gives `line2: null` — the caller
 * then renders exactly what it rendered before this helper existed. A
 * name that is only a separator and a remainder (" · Konstanz")
 * collapses to the remainder rather than printing an empty first line.
 */
export function venueNameLines(name: string): VenueNameLines {
  const raw = typeof name === "string" ? name : "";
  const at = raw.indexOf(VENUE_NAME_SEPARATOR);
  if (at === -1) return { line1: raw.trim(), line2: null };

  const line1 = raw.slice(0, at).trim();
  const line2 = raw.slice(at + VENUE_NAME_SEPARATOR.length).trim();
  if (line2 === "") return { line1, line2: null };
  // An empty first line is a typo, not a design: promote the remainder.
  if (line1 === "") return { line1: line2, line2: null };
  return { line1, line2 };
}
