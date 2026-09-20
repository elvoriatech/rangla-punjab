"use client";

import { useMemo } from "react";
import { reservationMonths, safeFormat, weekdayNames } from "@/lib/reservation-calendar";

/**
 * Date picker for the reservation dialog: the current month and the next
 * one as two calendar grids, Monday first, with every day the venue
 * cannot seat greyed out.
 *
 * This replaced a `<select>` of the next ~12 open days. The server now
 * offers the whole 60-day window it is willing to accept
 * (`RESERVATION_DAYS_AHEAD`), and sixty options in a dropdown is not a
 * date picker — a guest booking a birthday three weeks out was scrolling
 * a list to find "Sa., 11.10.".
 *
 * All copy is either a prop (the dialog's `ReserveLabels`, resolved
 * server-side per P7-16) or produced by `Intl` from the route locale, so
 * no catalogue is imported into this client chunk. Month names and
 * weekday initials therefore follow the guest's language for free, in
 * all six of them.
 */

/** 44px min per side: the cells are the one control here a guest taps
 *  repeatedly, and they sit close together. */
const CELL =
  "flex h-11 w-full items-center justify-center rounded-md text-sm tabular-nums " +
  "transition disabled:cursor-not-allowed";
const CELL_FREE =
  "text-[var(--menu-surface-text,var(--menu-text))] " +
  "bg-[var(--menu-surface-text,var(--menu-text))]/[0.06] " +
  "hover:bg-[var(--menu-surface-accent,var(--menu-accent))]/25 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--menu-surface-accent,var(--menu-accent))]";
/** The chosen day takes the panel's one dominant fill, like the CTA. */
const CELL_ON =
  "bg-[var(--menu-surface-accent,var(--menu-accent))] font-semibold " +
  "text-[var(--menu-on-surface-accent,var(--menu-bg))] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--menu-surface-accent,var(--menu-accent))]";
/** Closed, past, or past the booking horizon. Disabled controls are
 *  exempt from the 1.4.3 contrast minimum, which is what buys the fade. */
const CELL_OFF = "text-[var(--menu-surface-text-soft,var(--menu-text-soft))] opacity-35";

export function ReserveCalendar({
  dates,
  todayISO,
  locale,
  value,
  onSelect,
  labelledBy,
  monthCount = 2,
}: {
  /** Every bookable "YYYY-MM-DD", from `reservableDates`. */
  dates: readonly string[];
  /** The venue's local today — decides which month leads. */
  todayISO?: string | null;
  /** Venue/route locale, for `Intl` only. */
  locale: string;
  value: string;
  onSelect: (date: string) => void;
  /** id of the visible "Date" label, so the grid group is named. */
  labelledBy: string;
  monthCount?: number;
}): React.ReactElement {
  const months = useMemo(
    () => reservationMonths(dates, todayISO, monthCount),
    [dates, todayISO, monthCount],
  );
  const weekdays = useMemo(() => weekdayNames(locale, "narrow"), [locale]);
  const monthTitle = useMemo(
    () => safeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
    [locale],
  );
  /* Spoken name of a cell. A bare "14" is ambiguous across two grids, and
     a screen-reader user arrowing through 60 buttons would hear only
     digits — so every button says its whole date. */
  const dayTitle = useMemo(
    () =>
      safeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    [locale],
  );

  return (
    <div role="group" aria-labelledby={labelledBy} className="grid gap-5 sm:grid-cols-2">
      {months.map((month) => (
        <div key={month.key}>
          {/* Decorative: each day button already carries its month. */}
          <p
            aria-hidden="true"
            className="mb-2 text-center text-[13px] font-semibold capitalize text-[var(--menu-surface-text,var(--menu-text))]"
          >
            {monthTitle.format(month.at)}
          </p>
          <div
            aria-hidden="true"
            className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold uppercase text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
          >
            {weekdays.map((name, i) => (
              <span key={i} className="py-1">
                {name}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {month.weeks.map((week, w) =>
              week.map((cell, d) =>
                cell.date === null ? (
                  <span key={`${w}-${d}`} aria-hidden="true" className="h-11" />
                ) : (
                  <button
                    key={cell.date}
                    type="button"
                    disabled={!cell.available}
                    aria-pressed={value === cell.date}
                    aria-label={dayTitle.format(new Date(`${cell.date}T12:00:00Z`))}
                    onClick={() => onSelect(cell.date as string)}
                    className={`${CELL} ${
                      value === cell.date ? CELL_ON : cell.available ? CELL_FREE : CELL_OFF
                    }`}
                  >
                    {cell.day}
                  </button>
                ),
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
