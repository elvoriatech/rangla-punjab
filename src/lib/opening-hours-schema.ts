import { z } from "zod";
import type { DayHours, OpeningHours, Slot } from "./opening-hours";

/**
 * Validation for the `venues.hours` JSONB blob — the ONLY part of
 * opening hours that needs zod, kept apart from the pure readers in
 * `./opening-hours` on purpose (P7-16).
 *
 * `reserve-dialog.tsx` is a `"use client"` component and imports
 * `reservableDates` / `slotTimesForDate` from `./opening-hours`. While
 * the types there were `z.infer<…>` and the schema lived beside them,
 * that one import pulled all of zod (~65 KB gzipped) into every guest's
 * menu page. Nothing that runs in a browser parses raw JSONB, so the
 * schema belongs here, behind a server-only import.
 *
 * ⚠ Import this from server code only.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const slotSchema = z.object({
  open: z.string().regex(TIME_RE),
  close: z.string().regex(TIME_RE),
});

const daySchema = z.object({
  closed: z.boolean().default(false),
  slots: z.array(slotSchema).max(4).default([]),
});

export const openingHoursSchema = z.object({
  /** true only once the owner has saved hours — an unset venue shows
   *  no badge rather than a misleading "Closed". */
  configured: z.boolean().default(false),
  // String-keyed (not enum-keyed) so the record is partial — an
  // unconfigured or sparse map is valid; readers guard missing days.
  days: z.record(z.string(), daySchema).default({}),
});

/* The schema and the hand-written interfaces in `./opening-hours` are two
   statements of one shape, so tie them together: either drifting fails
   the build here rather than at runtime in a reader. */
type SchemaSlot = z.infer<typeof slotSchema>;
type SchemaDay = z.infer<typeof daySchema>;
type SchemaHours = z.infer<typeof openingHoursSchema>;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _slotsMatch: Exact<SchemaSlot, Slot> = true;
const _daysMatch: Exact<SchemaDay, DayHours> = true;
const _hoursMatch: Exact<SchemaHours, OpeningHours> = true;
void _slotsMatch;
void _daysMatch;
void _hoursMatch;

const EMPTY: OpeningHours = { configured: false, days: {} };

/** Read `venues.hours` JSONB into the canonical shape; anything
 *  unparseable degrades to "not configured" rather than throwing. */
export function parseOpeningHours(raw: unknown): OpeningHours {
  const parsed = openingHoursSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY;
}
