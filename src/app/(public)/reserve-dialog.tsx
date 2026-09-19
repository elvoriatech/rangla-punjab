"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OpeningHours } from "@/lib/opening-hours";
import { reservableDates, slotTimesForDate } from "@/lib/opening-hours";
import { menuCopy } from "@/lib/i18n/menu";

/**
 * Table-reservation dialog on the public menu. The date list holds only
 * days the venue is open (next 14) and the time list only slots inside
 * that day's opening windows — a guest can never pick an impossible
 * table. Submits a `requested` reservation; the restaurant confirms.
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
}: {
  slug: string;
  hours: OpeningHours;
  timezone: string;
  locale: string;
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
  const t = menuCopy(locale);
  const dateLabel = useMemo(() => dateFormatter(locale), [locale]);

  // Dates/slots are computed at open time so a dialog left open overnight
  // can't offer yesterday.
  const dates = useMemo(
    () => (open ? reservableDates(hours, timezone, new Date()) : []),
    [open, hours, timezone],
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
    dialogRef.current?.querySelector("select")?.focus();
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
            ? t.reserve.errorRateLimited
            : body.error === "invalid_time"
              ? t.reserve.errorInvalidTime
              : t.reserve.errorGeneric,
        );
        return;
      }
      setDone({ date, time });
    } catch {
      setError(t.reserve.errorGeneric);
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
        <span className="sm:hidden">{t.reserve.buttonShort}</span>
        <span className="hidden sm:inline">{t.reserve.buttonLong}</span>
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
            aria-label={t.reserve.title}
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[var(--menu-surface)] p-6 text-[var(--menu-surface-text,var(--menu-text))] shadow-2xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl">{t.reserve.title}</h2>
                <p className={`mt-1.5 text-sm ${INK_SOFT}`}>{t.reserve.holdNote}</p>
              </div>
              <button
                type="button"
                onClick={reset}
                aria-label={t.reserve.close}
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
                <h3 className="mt-4 font-serif text-xl">{t.reserve.received}</h3>
                <p className={`mt-2 text-sm ${INK_SOFT}`}>
                  {dateLabel.format(new Date(`${done.date}T12:00:00`))} · {done.time} ·{" "}
                  {t.reserve.guestCount(guests)}
                </p>
                <p className="mt-3 text-sm">{t.reserve.confirmByPhone}</p>
                <button type="button" onClick={reset} className={`mt-6 ${CTA}`}>
                  {t.reserve.done}
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className={FIELD_LABEL}>{t.reserve.date}</span>
                    <select
                      required
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setTime("");
                      }}
                      className={FIELD_SELECT}
                    >
                      <option value="" disabled>
                        {t.reserve.select}
                      </option>
                      {dates.map((d) => (
                        <option key={d.date} value={d.date}>
                          {dateLabel.format(new Date(`${d.date}T12:00:00`))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={FIELD_LABEL}>{t.reserve.time}</span>
                    <select
                      required
                      value={time}
                      disabled={!date}
                      onChange={(e) => setTime(e.target.value)}
                      className={`${FIELD_SELECT} disabled:opacity-60`}
                    >
                      <option value="" disabled>
                        {date ? t.reserve.select : t.reserve.pickDateFirst}
                      </option>
                      {slots.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Party size as a stepper, not a dropdown: one tap per guest,
                    no list to scroll. Bounds match the server (1–20). */}
                <div className="block">
                  <span className={FIELD_LABEL} id="reserve-guests-label">
                    {t.reserve.guests}
                  </span>
                  <div role="group" aria-labelledby="reserve-guests-label" className={STEP_BOX}>
                    <button
                      type="button"
                      onClick={() => setGuests((g) => Math.max(MIN_GUESTS, g - 1))}
                      disabled={guests <= MIN_GUESTS}
                      aria-label={`− 1 · ${t.reserve.guests}`}
                      className={STEP_BTN}
                    >
                      −
                    </button>
                    <span
                      className="min-w-[8ch] text-center text-base font-semibold"
                      aria-live="polite"
                    >
                      {t.reserve.guestCount(guests)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
                      disabled={guests >= MAX_GUESTS}
                      aria-label={`+ 1 · ${t.reserve.guests}`}
                      className={STEP_BTN}
                    >
                      +
                    </button>
                  </div>
                </div>

                <label className="block">
                  <span className={FIELD_LABEL}>{t.reserve.name}</span>
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
                  <span className={FIELD_LABEL}>{t.reserve.phone}</span>
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
                  <span className={FIELD_LABEL}>{t.reserve.note}</span>
                  <input
                    type="text"
                    maxLength={200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t.reserve.notePlaceholder}
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

                <button type="submit" disabled={busy || !date || !time} className={CTA}>
                  {busy ? t.reserve.sending : t.reserve.submit}
                </button>
                <p className={`text-center text-xs ${INK_SOFT}`}>{t.reserve.noPayment}</p>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
