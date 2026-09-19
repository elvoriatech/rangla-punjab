import { useWindowDimensions } from "react-native";

/**
 * Restaurant mode on a tablet.
 *
 * The guest half of this app is a phone app and stays one: a single
 * column, thumb-reachable, exactly the mockup. The RESTAURANT half is
 * not — it lives on a counter iPad or a 10" Android tablet, often
 * landscape, propped at arm's length, and a one-column board there
 * wastes two thirds of the glass.
 *
 * So the breakpoints below are about the SCREEN, not the device: a phone
 * turned on its side gets the same two columns an 8" tablet does,
 * because the constraint is width, and `useWindowDimensions` re-renders
 * on every rotation so nothing has to be invalidated by hand.
 *
 * Everything is in points (density-independent), never pixels.
 */

/** Two columns from here up — a small tablet, or a phone in landscape. */
export const TWO_COL_MIN = 700;
/** Three — a full-size tablet in landscape. */
export const THREE_COL_MIN = 1000;
/**
 * The widest a COLUMN OF TEXT gets, whatever the glass. A settings form
 * stretched across 1366 pt is unreadable: the eye loses the line.
 */
export const CONTENT_MAX = 720;
/** The floating tab bar stops growing here and centres instead. */
export const TAB_BAR_MAX = 560;
/** WCAG 2.1 AA (2.5.5) for a device used with wet or gloved hands. */
export const TOUCH_MIN = 44;
/** The widest a bottom sheet gets before it centres instead of growing. */
export const SHEET_MAX = 560;

/** The gap between board cards, and the padding around the grid — shared
 *  so the column arithmetic below can be exact rather than approximate. */
const GRID_GAP = 12;
const GRID_PAD = 16;

export interface Layout {
  /** Window width in points, live across rotations. */
  width: number;
  /** Board card columns: 1, 2 or 3. */
  columns: number;
  /**
   * Fixed card width for a multi-column grid, or `undefined` at one
   * column (where the card simply fills the row).
   *
   * Computed rather than expressed as a percentage because `gap` and `%`
   * widths fight: `50%` twice plus a 12 pt gap overflows by 12 pt and
   * silently drops to one card per row.
   */
  cardWidth: number | undefined;
  gap: number;
  pad: number;
  /** True once there is room for more than one column. */
  wide: boolean;
  /**
   * Centres a column of content and caps it. Spread onto the
   * `contentContainerStyle` of an owner screen's ScrollView.
   */
  content: { width: "100%"; maxWidth: number; alignSelf: "center" };
}

export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const columns = width >= THREE_COL_MIN ? 3 : width >= TWO_COL_MIN ? 2 : 1;
  const pad = width >= TWO_COL_MIN ? 20 : GRID_PAD;
  const cardWidth =
    columns === 1 ? undefined : (width - 2 * pad - (columns - 1) * GRID_GAP) / columns;
  return {
    width,
    columns,
    cardWidth,
    gap: GRID_GAP,
    pad,
    wide: columns > 1,
    content: { width: "100%", maxWidth: CONTENT_MAX, alignSelf: "center" },
  };
}
