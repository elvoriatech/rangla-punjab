import Link from "next/link";
import type { CSSProperties } from "react";
import type { GiftCardView } from "@/lib/gift-card-service";
import { giftCardPageCopy } from "@/lib/i18n/gift-card";
import { dirFor } from "@/lib/locales";
import type { UiLocale } from "@/lib/locales";

/**
 * The card the recipient sees. Pure render, no data access, so the page
 * above it is just "authorize → load → resolve locale" and this can be
 * unit-tested in all six languages without a database.
 *
 * Zero JS, like the order tracker it is modelled on: the QR is an `<img>`
 * served by `/api/gift-cards/{code}/qr`, the timeline is markup, and
 * everything directional uses logical utilities (`text-start`, `ms-*`) so
 * the Arabic render is the same layout mirrored rather than a second
 * stylesheet.
 *
 * Order of the page is the order of the recipient's questions: is it still
 * good (the banner), what is it worth, what is the code, until when.
 */

export function GiftCardShareCard({
  card,
  locale,
  themeStyle,
  timezone,
  token,
}: {
  card: GiftCardView;
  locale: UiLocale;
  themeStyle: CSSProperties;
  /** The venue's zone: an expiry date is a calendar date AT THE VENUE, and
   *  a card that dies at 23:59:59 Berlin must not read as the day before
   *  to someone opening the link in London. */
  timezone: string;
  /** Echoed into the QR URL — that route is guarded by the same token
   *  this page was opened with. */
  token: string;
}): React.ReactElement {
  const t = giftCardPageCopy(locale);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: card.currency });
  const day = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: timezone || "Europe/Berlin",
  });

  const spent = card.status !== "active";
  const dead =
    card.status === "redeemed"
      ? { title: t.redeemed, body: t.redeemedBody }
      : card.status === "expired"
        ? { title: t.expired, body: t.expiredBody }
        : card.status === "refunded"
          ? { title: t.refunded, body: t.refundedBody }
          : null;

  const qrUrl = `/api/gift-cards/${encodeURIComponent(card.codeFormatted)}/qr?t=${encodeURIComponent(token)}`;

  /** bought → link opened → redeemed. Steps that never happened are simply
   *  absent: an empty "not yet redeemed" row would invite the reader to
   *  wonder whether it is about to be. */
  const timeline: { key: string; label: string; at: string }[] = [
    { key: "bought", label: t.timelineBought, at: card.paidAt ?? card.createdAt },
  ];
  if (card.sharedAt) {
    timeline.push({ key: "shared", label: t.timelineShared, at: card.sharedAt });
  }
  if (card.redemption) {
    timeline.push({
      key: "redeemed",
      label:
        card.redemption.kind === "order"
          ? t.timelineRedeemedOrder(
              // The number is nullable only if the order row vanished; the
              // dash keeps the sentence grammatical rather than printing
              // "#0000", which reads as a real order that isn't.
              card.redemption.orderNumber === null
                ? "—"
                : String(card.redemption.orderNumber).padStart(4, "0"),
            )
          : t.timelineRedeemedCounter,
      at: card.redemption.at,
    });
  }

  const soft = "text-[var(--menu-surface-text-soft,var(--menu-text-soft))]";

  return (
    <main
      style={themeStyle}
      dir={dirFor(locale)}
      className="flex min-h-screen flex-col items-center bg-[var(--menu-bg)] px-4 py-10 text-[var(--menu-text)]"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-6 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.5)]">
        {/* Arabic is cursive — `uppercase`/`letter-spacing` only damage it. */}
        <p
          className={`text-center text-xs uppercase tracking-[0.28em] rtl:normal-case rtl:tracking-normal ${soft}`}
        >
          {t.title}
        </p>

        {/* The first question is "can I still use this?", so the answer is
            the first thing on the page — above the value, above the code. */}
        {dead ? (
          <div
            className="mt-4 rounded-xl border p-4 text-center"
            style={{
              borderColor: "color-mix(in oklab, var(--menu-danger) 45%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--menu-danger) 10%, transparent)",
            }}
          >
            <p className="text-base font-semibold" style={{ color: "var(--menu-danger)" }}>
              {dead.title}
            </p>
            <p className={`mt-2 text-sm ${soft}`}>{dead.body}</p>
          </div>
        ) : (
          <p className="mt-4 text-center">
            <span
              className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: "color-mix(in oklab, var(--menu-positive) 14%, transparent)",
                color: "var(--menu-positive)",
              }}
            >
              ✓ {t.statusActive}
            </span>
          </p>
        )}

        {/* `imagePath`, not `imageUrl`: this page is served from the same
            origin, so the same-origin path renders whatever APP_URL is set
            to and whether or not it is reachable from the viewer. */}
        {card.imagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.imagePath}
            alt={t.imageAlt}
            className={`mt-5 w-full rounded-xl object-cover ${spent ? "opacity-60 grayscale" : ""}`}
          />
        ) : null}

        {/* The value IS the headline. The label is spoken but not drawn:
            nobody needs the word "Value" above a price that large. */}
        <h1 className="mt-5 text-center font-serif text-4xl tabular-nums">
          <span className="sr-only">{t.valueLabel}: </span>
          {money.format(card.valueCents / 100)}
        </h1>
        {card.productName ? (
          <p className={`mt-1 text-center text-sm ${soft}`}>{card.productName}</p>
        ) : null}
        {card.recipientName ? (
          <p className="mt-2 text-center text-base font-semibold">
            {t.forLabel(card.recipientName)}
          </p>
        ) : null}
        {!dead ? <p className={`mt-4 text-center text-sm ${soft}`}>{t.lead}</p> : null}

        {card.message ? (
          <figure className="mt-5 rounded-xl bg-[var(--menu-surface-text,var(--menu-text))]/6 px-4 py-3">
            <figcaption
              className={`text-xs font-semibold uppercase tracking-wide ${soft} rtl:normal-case rtl:tracking-normal`}
            >
              {t.messageLabel}
            </figcaption>
            <blockquote className="mt-1 whitespace-pre-wrap text-start text-sm italic">
              {card.message}
            </blockquote>
          </figure>
        ) : null}

        {/* The code has to be readable across a dining room, and it is
            Latin characters regardless of the page language — hence the
            explicit `dir="ltr"`, so an Arabic render does not reorder the
            dashed groups the cashier is typing. */}
        <div className="mt-6 rounded-xl border border-dashed border-[var(--menu-surface-accent,var(--menu-accent))]/40 px-4 py-5 text-center">
          <p
            className={`text-xs font-semibold uppercase tracking-wide ${soft} rtl:normal-case rtl:tracking-normal`}
          >
            {t.codeLabel}
          </p>
          {/* Never wraps. This is the one string on the page a cashier
              reads aloud or a guest copies by hand, and a code broken
              across two lines invites exactly the transcription error
              the unambiguous alphabet exists to prevent. The size is
              fluid rather than stepped so it shrinks to fit a 320px
              phone instead of folding. */}
          <p
            dir="ltr"
            className="mt-2 whitespace-nowrap font-mono font-bold tracking-[0.14em] text-[var(--menu-surface-accent,var(--menu-accent))] sm:tracking-[0.18em]"
            style={{ fontSize: "clamp(1.15rem, 7.2vw, 1.875rem)" }}
          >
            {card.codeFormatted}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt={t.qrAlt}
            width={200}
            height={200}
            className={`mx-auto mt-4 h-44 w-44 rounded-lg bg-white p-2 ${spent ? "opacity-50" : ""}`}
          />
        </div>

        {card.expiresAt ? (
          <p className={`mt-4 text-center text-sm ${soft}`}>
            <time dateTime={card.expiresAt}>{t.expiry(day.format(new Date(card.expiresAt)))}</time>
          </p>
        ) : null}
        {!dead ? <p className="mt-2 text-center text-sm">{t.howTo}</p> : null}

        <section className="mt-7 border-t border-[var(--menu-surface-text,var(--menu-text))]/12 pt-5">
          <h2
            className={`text-xs font-semibold uppercase tracking-wide ${soft} rtl:normal-case rtl:tracking-normal`}
          >
            {t.timelineTitle}
          </h2>
          <ol className="mt-3 space-y-0">
            {timeline.map((step, i) => (
              <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < timeline.length - 1 ? (
                  <span
                    aria-hidden="true"
                    /* Logical inset: the rail runs under the bullets on
                       whichever side the text starts. */
                    className="absolute start-[7px] top-4 h-[calc(100%-1rem)] w-0.5"
                    style={{
                      backgroundColor:
                        "color-mix(in oklab, var(--menu-surface-text, var(--menu-text)) 22%, transparent)",
                    }}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="z-10 mt-1 h-4 w-4 shrink-0 rounded-full border-2"
                  style={{
                    backgroundColor: "var(--menu-surface-accent, var(--menu-accent))",
                    borderColor: "var(--menu-surface-accent, var(--menu-accent))",
                  }}
                />
                <span className="text-start text-sm">
                  <span className="font-semibold">{step.label}</span>
                  <br />
                  <time className={soft} dateTime={step.at}>
                    {day.format(new Date(step.at))}
                  </time>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <p className={`mt-6 text-center text-xs ${soft}`}>{t.legal}</p>
        <p className="mt-3 text-center text-xs">
          <Link href="/" className="underline underline-offset-4">
            {t.backToMenu}
          </Link>
        </p>
      </div>
    </main>
  );
}
