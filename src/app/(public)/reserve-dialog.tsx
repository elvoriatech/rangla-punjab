"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OpeningHours } from "@/lib/opening-hours";
import { reservableDates, slotTimesForDate, venueDateISO } from "@/lib/opening-hours";
import { RequiredLegend, RequiredMark } from "@/components/required-mark";
import { ReserveCalendar } from "./reserve-calendar";

/**
 * Every string this dialog says, resolved for the guest's language by the
 * server that renders the menu (P7-16: a client component never imports a
 * five-locale catalogue).
 *
 * `guestCounts` is the pre-rendered party-size label for 1…MAX_GUESTS
 * people (index 0 = one guest). A lookup table rather than a `{n}`
 * template because plural rules differ per language — Arabic alone needs
 * four forms — and 20 short strings in ONE language cost less than
 * shipping a plural engine plus five catalogues.
 */
export interface ReserveLabels {
  buttonShort: string;
  buttonLong: string;
  title: string;
  holdNote: string;
  close: string;
  received: string;
  confirmByPhone: string;
  done: string;
  date: string;
  time: string;
  guests: string;
  name: string;
  phone: string;
  note: string;
  select: string;
  pickDateFirst: string;
  guestCounts: string[];
  notePlaceholder: string;
  sending: string;
  submit: string;
  noPayment: string;
  errorRateLimited: string;
  errorInvalidTime: string;
  errorGeneric: string;
  /** Required-field convention: the star's spoken form, and the line that
   *  explains it once per form (`src/components/required-mark.tsx`). */
  requiredMark: string;
  requiredLegend: string;
}

/**
 * Table-reservation dialog on the public menu. The date CALENDAR enables
 * only days the venue is open (over the whole `RESERVATION_DAYS_AHEAD`
 * window the endpoint accepts) and the time list only slots inside that
 * day's opening windows — a guest can never pick an impossible table.
 * Submits a `requested` reservation; the restaurant confirms.
 *
 * Pure client enhancement of the menu page: without JS the button simply
 * does nothing, and no ordering path depends on it.
 */

/**
 * The panel sits on --menu-surface, so every glyph inside takes SURFACE
 * ink. On split-surface themes (cream cards on a deep-red page) the page
 * pair --menu-bg/--menu-text measures 1.86:1 — the panel was effectively
 * unreadable — while the surface pair measures 10.67:1. Same reasoning
 * as the cart drawer's palette.
 */
const INK_SOFT = "text-[var(--menu-surface-text-soft,var(--menu-text-soft))]";
const FIELD_LABEL =
  "mb-1.5 block text-[13px] font-semibold text-[var(--menu-surface-text,var(--menu-text))]";
const FIELD =
  "block w-full rounded-md border border-[var(--menu-surface-text,var(--menu-text))]/25 " +
  "bg-[var(--menu-surface-text,var(--menu-text))]/[0.08] px-3.5 py-3 text-base " +
  "text-[var(--menu-surface-text,var(--menu-text))] outline-none " +
  "placeholder:text-[var(--menu-surface-text-soft,var(--menu-text-soft))] " +
  "focus:border-[var(--menu-surface-accent,var(--menu-accent))] " +
  "focus:ring-2 focus:ring-[var(--menu-surface-accent,var(--menu-accent))]/40";
/** Native <select> paints its popup from the control — pin option colors
 *  or Chrome renders ink-on-ink. */
const FIELD_SELECT =
  FIELD +
  " [&>option]:bg-[var(--menu-surface)] [&>option]:text-[var(--menu-surface-text,var(--menu-text))]";
/** The one dominant fill in the panel — surface accent + its own ink. */
/** Party-size bounds — the same 1..20 the reservation endpoint enforces. */
const MIN_GUESTS = 1;
const MAX_GUESTS = 20;
/** The ± buttons and the count inherit the panel's ink, like every field. */
const STEP_BTN =
  "flex h-11 w-11 items-center justify-center rounded-full border " +
  "border-[var(--menu-surface-text,var(--menu-text))]/40 text-2xl leading-none " +
  "text-[var(--menu-surface-text,var(--menu-text))] transition " +
  "hover:border-[var(--menu-surface-accent,var(--menu-accent))] active:scale-95 " +
  "disabled:cursor-not-allowed disabled:opacity-35";
const STEP_BOX =
  "mt-1 flex items-center justify-between rounded-md border " +
  "border-[var(--menu-surface-text,var(--menu-text))]/25 " +
  "bg-[var(--menu-surface-text,var(--menu-text))]/[0.08] px-2 py-1.5 " +
  "text-[var(--menu-surface-text,var(--menu-text))]";

/**
 * The panel. Wider from `sm:` up than the other guest sheets: two month
 * grids side by side need ~300px each for the day cells to stay a
 * comfortable target. On phones it is still a full-width bottom sheet
 * and the two months stack.
 */
const PANEL =
  "max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[var(--menu-surface)] " +
  "p-6 text-[var(--menu-surface-text,var(--menu-text))] shadow-2xl " +
  "sm:max-w-2xl sm:rounded-2xl";

const CTA =
  "w-full rounded-md bg-[var(--menu-surface-accent,var(--menu-accent))] py-3.5 text-base " +
  "font-semibold text-[var(--menu-on-surface-accent,var(--menu-bg))] hover:opacity-90 disabled:opacity-50";

/** Day + date, in the guest's language — the formatter was pinned to
 *  `de-DE`, which handed a Spanish guest "Mi., 12.03." Built per render
 *  because the locale is a prop; `Intl` caches the heavy work itself. */
function dateFormatter(locale: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return new Intl.DateTimeFormat("en", { weekday: "short", day: "2-digit", month: "2-digit" });
  }
}

export function ReserveDialog({
  slug,
  hours,
  timezone,
  locale,
  labels,
}: {
  slug: string;
  hours: OpeningHours;
  timezone: string;
  /** Venue/route locale — only for `Intl` date formatting, not for copy. */
  locale: string;
  labels: ReserveLabels;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ date: string; time: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dateLabel = useMemo(() => dateFormatter(locale), [locale]);

  // Dates/slots are computed at open time so a dialog left open overnight
  // can't offer yesterday.
  const dates = useMemo(
    () => (open ? reservableDates(hours, timezone, new Date()).map((d) => d.date) : []),
    [open, hours, timezone],
  );
  /* Which month the calendar leads with: the VENUE's today, not the
     browser's — a guest booking from another timezone must see the same
     grid the venue's opening hours were computed against. */
  const todayISO = useMemo(
    () => (open ? venueDateISO(timezone, new Date()) : null),
    [open, timezone],
  );
  const slots = useMemo(
    () => (date ? slotTimesForDate(hours, timezone, date, new Date()) : []),
    [hours, timezone, date],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // First bookable day, else the time select — the date used to be the
    // dialog's first `<select>`, and it is now a grid of buttons.
    dialogRef.current
      ?.querySelector<HTMLElement>("button[aria-pressed]:not(:disabled), select")
      ?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Venues without configured hours can't offer valid slots — no button.
  if (!hours.configured) return null;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: name.trim(),
          phone: phone.trim(),
          guests,
          date,
          time,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === "rate_limited"
            ? labels.errorRateLimited
            : body.error === "invalid_time"
              ? labels.errorInvalidTime
              : labels.errorGeneric,
        );
        return;
      }
      setDone({ date, time });
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  const reset = (): void => {
    setOpen(false);
    setDone(null);
    setDate("");
    setTime("");
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="z-10 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--menu-accent)] py-1.5 ps-2.5 pe-3 text-xs font-semibold text-[var(--menu-on-accent,#fff)] shadow-sm hover:opacity-90"
      >
        {/* Inline calendar glyph — no icon library on the guest bundle. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        {/* Two whole phrases rather than a word plus a suffix: only
            English happens to grow the long form by appending. */}
        <span className="sm:hidden">{labels.buttonShort}</span>
        <span className="hidden sm:inline">{labels.buttonLong}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) reset();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={labels.title}
            className={PANEL}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl">{labels.title}</h2>
                <p className={`mt-1.5 text-sm ${INK_SOFT}`}>{labels.holdNote}</p>
              </div>
              <button
                type="button"
                onClick={reset}
                aria-label={labels.close}
                className="rounded p-1 text-2xl leading-none text-[var(--menu-surface-text-soft,var(--menu-text-soft))] hover:text-[var(--menu-surface-text,var(--menu-text))]"
              >
                ×
              </button>
            </div>

            {done ? (
              <div className="mt-6 text-center">
                <p
                  aria-hidden="true"
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--menu-positive)]/15 text-3xl"
                >
                  ✓
                </p>
                <h3 className="mt-4 font-serif text-xl">{labels.received}</h3>
                <p className={`mt-2 text-sm ${INK_SOFT}`}>
                  {dateLabel.format(new Date(`${done.date}T12:00:00`))} · {done.time} ·{" "}
                  {labels.guestCounts[guests - 1]}
                </p>
                <p className="mt-3 text-sm">{labels.confirmByPhone}</p>
                <button type="button" onClick={reset} className={`mt-6 ${CTA}`}>
                  {labels.done}
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-5">
                {/* Date as a calendar, not a 60-entry dropdown. Choosing a
                    day clears the time: the slots differ per weekday. */}
                <div className="block">
                  <span className={FIELD_LABEL} id="reserve-date-label">
                    {labels.date}
                    <RequiredMark label={labels.requiredMark} />
                  </span>
                  <ReserveCalendar
                    dates={dates}
                    todayISO={todayISO}
                    locale={locale}
                    value={date}
                    labelledBy="reserve-date-label"
                    onSelect={(d) => {
                      setDate(d);
                      setTime("");
                    }}
                  />
                </div>
                <label className="block">
                  <span className={FIELD_LABEL}>
                    {labels.time}
                    <RequiredMark label={labels.requiredMark} />
                  </span>
                  <select
                    required
                    value={time}
                    disabled={!date}
                    onChange={(e) => setTime(e.target.value)}
                    className={`${FIELD_SELECT} disabled:opacity-60`}
                  >
                    <option value="" disabled>
                      {date ? labels.select : labels.pickDateFirst}
                    </option>
                    {slots.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Party size as a stepper, not a dropdown: one tap per guest,
                    no list to scroll. Bounds match the server (1–20). */}
                <div className="block">
                  <span className={FIELD_LABEL} id="reserve-guests-label">
                    {labels.guests}
                  </span>
                  <div role="group" aria-labelledby="reserve-guests-label" className={STEP_BOX}>
                    <button
                      type="button"
                      onClick={() => setGuests((g) => Math.max(MIN_GUESTS, g - 1))}
                      disabled={guests <= MIN_GUESTS}
                      aria-label={`− 1 · ${labels.guests}`}
                      className={STEP_BTN}
                    >
                      −
                    </button>
                    <span
                      className="min-w-[8ch] text-center text-base font-semibold"
                      aria-live="polite"
                    >
                      {labels.guestCounts[guests - 1]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
                      disabled={guests >= MAX_GUESTS}
                      aria-label={`+ 1 · ${labels.guests}`}
                      className={STEP_BTN}
                    >
                      +
                    </button>
                  </div>
                </div>

                <label className="block">
                  <span className={FIELD_LABEL}>
                    {labels.name}
                    <RequiredMark label={labels.requiredMark} />
                  </span>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    className={FIELD}
                  />
                </label>
                <label className="block">
                  <span className={FIELD_LABEL}>
                    {labels.phone}
                    <RequiredMark label={labels.requiredMark} />
                  </span>
                  <input
                    type="tel"
                    required
                    minLength={5}
                    maxLength={30}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    placeholder="+49 …"
                    className={FIELD}
                  />
                </label>
                <label className="block">
                  <span className={FIELD_LABEL}>{labels.note}</span>
                  <input
                    type="text"
                    maxLength={200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={labels.notePlaceholder}
                    className={FIELD}
                  />
                </label>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-md bg-[var(--menu-danger)]/20 px-3 py-2.5 text-sm text-[var(--menu-surface-text,var(--menu-text))]"
                  >
                    {error}
                  </p>
                ) : null}

                {/* One legend for the form: date, time, name and phone all
                    carry the star above. */}
                <RequiredLegend label={labels.requiredLegend} className={`text-xs ${INK_SOFT}`} />

                <button type="submit" disabled={busy || !date || !time} className={CTA}>
                  {busy ? labels.sending : labels.submit}
                </button>
                <p className={`text-center text-xs ${INK_SOFT}`}>{labels.noPayment}</p>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
