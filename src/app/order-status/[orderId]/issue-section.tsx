import type { CSSProperties } from "react";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { dirFor } from "@/lib/locales";
import type { UiLocale } from "@/lib/locales";
import { RequiredLegend, RequiredMark } from "@/components/required-mark";

/**
 * "Report a problem" under the tracker: one thread per order, guest on one
 * side, restaurant on the other. Pure render — no data access, no state —
 * so the page above it stays "authorize → load → resolve locale" and this
 * can be unit-tested in all five languages without a database.
 *
 * Zero JS, like the tracker: the composer is a plain `<form>` posting to a
 * server action, the result of that post comes back as `?issue=` on the
 * redirect, and photos are ordinary `<img>` tags pointing at the
 * token-gated photo route. Everything directional uses logical utilities
 * so the Arabic render is the same layout mirrored.
 *
 * The message/state shapes below MIRROR `GuestIssueState` from
 * `@/lib/issue-service` on purpose rather than importing it: keeping the
 * render free of the service keeps this file (and its test) independent of
 * the database layer.
 */

export type IssueSectionStatus = "open" | "answered" | "resolved";

export interface IssueSectionMessage {
  id: string;
  author: "guest" | "restaurant";
  body: string;
  hasPhoto: boolean;
  /** ISO 8601. */
  createdAt: string;
}

export interface IssueSectionThread {
  id: string;
  status: IssueSectionStatus;
  messages: IssueSectionMessage[];
}

export interface IssueSectionState {
  canReport: boolean;
  windowEndsAt: string;
  issue: IssueSectionThread | null;
}

type Copy = ReturnType<typeof postOrderCopy>["issue"];

/** The one-line banner for `?issue=…`: `sent` is the happy path, every
 *  other code is an error the guest can act on (the service's snake_case
 *  codes map onto the copy catalogue's camelCase keys here). */
function resultBanner(t: Copy, result: string | null | undefined) {
  if (!result) return null;
  if (result === "sent") return { ok: true, text: t.sent };
  const text =
    result === "invalid"
      ? t.errors.invalid
      : result === "invalid_photo"
        ? t.errors.invalidPhoto
        : result === "too_large"
          ? t.errors.tooLarge
          : result === "window_closed"
            ? t.errors.windowClosed
            : result === "resolved"
              ? t.errors.resolved
              : result === "not_found"
                ? t.errors.notFound
                : t.errors.failed;
  return { ok: false, text };
}

export function IssueSection({
  locale,
  themeStyle,
  orderId,
  token,
  timezone,
  state,
  result,
  action,
  compose = false,
  liveTracking = false,
}: {
  locale: UiLocale;
  themeStyle: CSSProperties;
  orderId: string;
  /** Receipt token — the guest's only credential, echoed into the form
   *  and into every photo URL. */
  token: string;
  timezone: string;
  state: IssueSectionState;
  /** `?issue=` from the redirect the server action performed. */
  result?: string | null;
  /** The server action the composer posts to. */
  action: (formData: FormData) => void | Promise<void>;
  /** `?compose=1`: the guest asked for the writing box. */
  compose?: boolean;
  /** The tracker above is auto-refreshing (order not done yet). While it
   *  is, the composer hides behind a link — a 15-second meta refresh
   *  would wipe whatever the guest had typed. On a finished order there
   *  is no refresh, so the box is simply open. */
  liveTracking?: boolean;
}): React.ReactElement | null {
  const copy = postOrderCopy(locale);
  const t = copy.issue;
  const thread = state.issue;
  const banner = resultBanner(t, result);

  // Nothing to say and nothing to show: no thread, window closed and no
  // banner to explain a failed attempt — stay out of the guest's way.
  if (!thread && !state.canReport && !banner) {
    return (
      <section
        id="issue"
        style={themeStyle}
        dir={dirFor(locale)}
        className="flex flex-col items-center bg-[var(--menu-bg)] px-4 pb-12 text-[var(--menu-text)]"
      >
        <p className="w-full max-w-md text-center text-xs text-[var(--menu-text-soft)]">
          {t.windowClosed}
        </p>
      </section>
    );
  }

  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone || "Europe/Berlin",
  });
  const photoUrl = (messageId: string): string =>
    `/api/v1/orders/${encodeURIComponent(orderId)}/issue/photo/${encodeURIComponent(
      messageId,
    )}?token=${encodeURIComponent(token)}`;
  const isResolved = thread?.status === "resolved";
  const canWrite = thread ? !isResolved : state.canReport;
  // Open the box straight away when nothing is refreshing underneath it;
  // otherwise the guest opens it themselves and the page stops refreshing
  // for as long as `?compose=1` is on the URL.
  const showComposer = canWrite && (compose || !liveTracking);
  const trackingHref = (composing: boolean): string => {
    const query = new URLSearchParams({ token });
    if (locale) query.set("locale", locale);
    if (composing) query.set("compose", "1");
    return `/order-status/${encodeURIComponent(orderId)}?${query.toString()}#issue`;
  };

  const hiddenFields = (
    <>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );

  const fieldClass =
    "mt-1 w-full rounded-lg border border-[var(--menu-surface-text,var(--menu-text))]/25 bg-[var(--menu-surface)] px-3 py-2 text-sm text-[var(--menu-surface-text,var(--menu-text))] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]";
  const buttonClass =
    "mt-3 w-full rounded-lg bg-[var(--menu-surface-accent,var(--menu-accent))] px-4 py-3 text-sm font-semibold text-[var(--menu-surface,#fff)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-accent,var(--menu-accent))]";

  return (
    <section
      id="issue"
      style={themeStyle}
      dir={dirFor(locale)}
      className="flex flex-col items-center bg-[var(--menu-bg)] px-4 pb-12 text-[var(--menu-text)]"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-6 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.5)]">
        <h2 className="text-start font-serif text-xl">{thread ? t.threadTitle : t.title}</h2>

        {banner ? (
          <p
            role={banner.ok ? "status" : "alert"}
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              banner.ok
                ? "bg-[var(--menu-positive)]/15 text-[var(--menu-surface-text,var(--menu-text))]"
                : "bg-[#b3261e]/12 text-[#b3261e]"
            }`}
          >
            {banner.text}
          </p>
        ) : null}

        {thread ? (
          <>
            <p className="mt-2 text-start text-xs font-semibold uppercase tracking-[0.16em] rtl:normal-case rtl:tracking-normal text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
              {t.statusLabels[thread.status]}
            </p>
            <ol className="mt-4 space-y-3">
              {thread.messages.map((message) => {
                const who = message.author === "guest" ? t.youLabel : t.restaurantLabel;
                return (
                  <li
                    key={message.id}
                    className={`rounded-xl px-3 py-2 text-sm ${
                      message.author === "guest"
                        ? "bg-[var(--menu-surface-text,var(--menu-text))]/8"
                        : "border border-[var(--menu-surface-accent,var(--menu-accent))]/40 bg-[var(--menu-surface-accent,var(--menu-accent))]/10"
                    }`}
                  >
                    <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      <span className="font-semibold">{who}</span>
                      <time dateTime={message.createdAt}>
                        {time.format(new Date(message.createdAt))}
                      </time>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-start">{message.body}</p>
                    {message.hasPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl(message.id)}
                        alt={t.photoAlt(who)}
                        loading="lazy"
                        className="mt-2 max-h-64 w-full rounded-lg object-contain"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="mt-2 text-start text-sm text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            {t.intro}
          </p>
        )}

        {isResolved ? (
          <p className="mt-4 text-start text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            {t.resolvedNote}
          </p>
        ) : null}

        {canWrite && !showComposer ? (
          <p className="mt-4">
            <a
              href={trackingHref(true)}
              className="inline-block rounded-lg border border-[var(--menu-surface-accent,var(--menu-accent))] px-4 py-2.5 text-sm font-semibold text-[var(--menu-surface-accent,var(--menu-accent))] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-accent,var(--menu-accent))]"
            >
              {thread ? t.replyLink : t.reportLink}
            </a>
          </p>
        ) : null}

        {showComposer ? (
          <form action={action} className="mt-4">
            {hiddenFields}
            <label htmlFor="issue-body" className="block text-start text-sm font-semibold">
              {thread ? t.replyLabel : t.bodyLabel}
              <RequiredMark label={copy.required.mark} />
            </label>
            <textarea
              id="issue-body"
              name="body"
              rows={4}
              required
              maxLength={2000}
              placeholder={thread ? t.replyPlaceholder : t.placeholder}
              className={fieldClass}
            />
            <label htmlFor="issue-photo" className="mt-3 block text-start text-sm font-semibold">
              {t.addPhoto}
            </label>
            <input
              id="issue-photo"
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby="issue-photo-hint"
              className="mt-1 w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-[var(--menu-surface-text,var(--menu-text))]/10 file:px-3 file:py-2 file:text-sm file:text-[var(--menu-surface-text,var(--menu-text))]"
            />
            <span
              id="issue-photo-hint"
              className="mt-1 block text-start text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
            >
              {t.photoHint}
            </span>
            {/* The message is the only required field here — the photo
                is optional — so one star and one legend. */}
            <RequiredLegend
              label={copy.required.legend}
              className="mt-3 text-start text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
            />
            <button type="submit" className={buttonClass}>
              {thread ? t.replySend : t.send}
            </button>
            {liveTracking ? (
              <p className="mt-3 text-start text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                {t.pausedNote}{" "}
                <a href={trackingHref(false)} className="underline underline-offset-4">
                  {t.backToTracking}
                </a>
              </p>
            ) : null}
          </form>
        ) : !thread && !canWrite ? (
          // Only when the guest genuinely cannot open a thread. A live
          // order behind the compose link still has `canWrite` — saying
          // "the window has closed" next to a "Report a problem" link
          // would contradict itself.
          <p className="mt-4 text-start text-sm text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            {t.windowClosed}
          </p>
        ) : null}
      </div>
    </section>
  );
}
