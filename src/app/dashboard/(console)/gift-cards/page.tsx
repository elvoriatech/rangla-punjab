import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import { SubmitButton } from "@/components/submit-button";
import { getSessionUserId } from "@/lib/auth";
import { formatPrice } from "@/lib/public-menu";
import {
  GIFT_CARD_STATUS_FILTERS,
  getGiftCardReport,
  isGiftCardStatusFilter,
  type GiftCardRedemption,
  type GiftCardStatusFilter,
} from "@/lib/gift-card-service";
import { getVenueForUser, getVenueHours } from "@/lib/venue-service";
import { redeemGiftCardAction } from "./actions";

/**
 * Gift cards — every card this venue has sold, and the counter's redeem
 * box.
 *
 * Two audiences, one page. Staff need the top: type a code, take the card.
 * The owner and their accountant need the rest: what is still outstanding
 * (money taken, food not yet served) and WHEN each card was redeemed —
 * a gift card is a multi-purpose voucher (§ 3 Abs. 14 UStG), so the VAT
 * falls due at redemption, not at sale.
 */

const STATUS_LABELS: Record<GiftCardStatusFilter, string> = {
  all: "All cards",
  active: "Unspent",
  redeemed: "Redeemed",
  expired: "Expired",
  refunded: "Refunded",
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-[#3f7030]/15 text-[#3f7030]",
  redeemed: "bg-ink/10 text-muted",
  expired: "bg-orange/15 text-orange-dark",
  refunded: "bg-red-900/10 text-red-900",
};

/** What a card's state means to the person reading the row. */
const STATUS_WORDS: Record<string, string> = {
  active: "unspent",
  redeemed: "redeemed",
  expired: "expired",
  refunded: "refunded",
};

/**
 * Every way the counter can be turned down, said the way you would say it
 * to the guest in front of you. "That didn't work" in front of someone
 * holding a card they were given for their birthday is the least useful
 * thing this page could say.
 */
const REDEEM_ERRORS: Record<string, string> = {
  unknown:
    "No card with that code. Check the letters against the card — I, L, O and U are never used on ours, so one of those is a misread.",
  not_paid:
    "That card hasn't been paid for. It was started in the app but the payment never went through, so there's nothing on it yet.",
  expired: "That card has expired. Its term ran out, so it can no longer be spent.",
  already_redeemed:
    "That card has already been used. Find it in the list below — the row says when it was redeemed and who took it.",
  refunded: "That card was refunded. The guest has the money back, so there's nothing left on it.",
  wrong_venue: "That card was bought for another of your branches. It has to be redeemed there.",
};

export default async function GiftCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;

  const { status, saved, error } = await searchParams;
  const filter: GiftCardStatusFilter = isGiftCardStatusFilter(status) ? status : "all";
  const report = await getGiftCardReport(venue.tenantId, venue.id, filter);

  // Dates read in the restaurant's own clock — a card bought at 23:40 in
  // Berlin must not show as the day before because the server is on UTC.
  const hoursResult = await getVenueHours(userId);
  const timeZone = hoursResult.ok ? hoursResult.value.timezone : "Europe/Berlin";
  const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone });
  const dayTime = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const date = (iso: string | null): string => (iso ? day.format(new Date(iso)) : "—");
  // Money in the restaurant's own format, like the Berichte page: these
  // numbers get read next to the till receipts, not next to English prose.
  const money = (cents: number): string => formatPrice(cents, venue.currency, "de");

  const redeemed = (r: GiftCardRedemption): React.ReactElement => {
    if (!r) return <span className="text-muted">—</span>;
    if (r.kind === "order") {
      return (
        <span>
          Redeemed on order #{r.orderNumber === null ? "—" : String(r.orderNumber).padStart(4, "0")}
          <span className="block text-xs text-muted">{dayTime.format(new Date(r.at))}</span>
        </span>
      );
    }
    return (
      <span>
        {r.staffName ? `Taken by ${r.staffName}` : "Taken at the counter"}
        <span className="block text-xs text-muted">{dayTime.format(new Date(r.at))}</span>
        {r.note ? <span className="block text-xs text-muted">“{r.note}”</span> : null}
      </span>
    );
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 text-ink sm:px-6 md:py-12 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Gift cards</p>
          <h1 className="font-serif text-4xl leading-tight">Cards sold</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Every gift card your guests have paid for. Take one at the counter with the box below;
            cards spent in the app show up here on their own.
          </p>
        </div>
        <a
          href={`/dashboard/gift-cards/export.csv?status=${filter}`}
          className="border border-ink/20 bg-card px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] hover:border-orange"
        >
          CSV export
        </a>
      </div>

      {saved ? (
        <FlashMessage
          kind="success"
          text="Card redeemed. Its full value is spent — it can't be used a second time."
        />
      ) : null}
      {error ? (
        <FlashMessage
          kind="error"
          text={
            REDEEM_ERRORS[error] ?? "That card couldn't be redeemed. Check the code and try again."
          }
        />
      ) : null}

      {/* Redeem — first, because it is the thing done under time pressure
          with a guest waiting, and everything below it is reading. */}
      <section aria-label="Redeem a card" className="mt-8 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Take a card at the counter</p>
        <p className="mt-1 text-xs text-muted">
          Type the code from the guest&apos;s card. The whole value is spent in one go — there is no
          balance left over, so tell the guest before you take it.
        </p>
        <form action={redeemGiftCardAction} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block text-sm">
            <span className="font-medium">Card code</span>
            <input
              type="text"
              name="code"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              placeholder="ABCD-EFGH-JKMN"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 font-mono text-base uppercase tracking-widest outline-none focus:border-ink"
            />
            <span className="mt-1 block text-xs text-muted">
              Dashes and lower case are fine — we tidy them up.
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Note (optional)</span>
            <input
              type="text"
              name="note"
              autoComplete="off"
              maxLength={200}
              placeholder="Table 4, lunch"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-base outline-none focus:border-ink"
            />
            <span className="mt-1 block text-xs text-muted">
              Kept with the card, for when the till doesn&apos;t add up.
            </span>
          </label>
          <SubmitButton
            pendingLabel="Redeeming…"
            className="h-[42px] self-start bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark sm:mt-6"
          >
            Redeem
          </SubmitButton>
        </form>
      </section>

      {/* Totals */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Tile
          label="Sold"
          value={money(report.totals.soldCents)}
          sub={`${report.totals.soldCount} ${report.totals.soldCount === 1 ? "card" : "cards"} paid for`}
        />
        <Tile
          label="Redeemed"
          value={money(report.totals.redeemedCents)}
          sub={`${report.totals.redeemedCount} spent — VAT falls due on these`}
        />
        <Tile
          label="Outstanding"
          value={money(report.totals.outstandingCents)}
          sub={`${report.totals.outstandingCount} unspent — food you still owe`}
          strong
        />
      </div>
      <p className="mt-3 text-xs text-muted">
        Outstanding is a liability, not takings: the money is in the till but the meal hasn&apos;t
        been served. Expired and refunded cards drop out of it — one you will never have to honour,
        the other already paid back.
      </p>

      {/* Status filter */}
      <nav aria-label="Filter by status" className="mt-8 flex flex-wrap items-center gap-2">
        {GIFT_CARD_STATUS_FILTERS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/dashboard/gift-cards" : `/dashboard/gift-cards?status=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={`rounded-2xl px-4 py-2 text-sm transition-colors [border-bottom-right-radius:3px] ${
              filter === key
                ? "bg-orange font-semibold text-card"
                : "border border-ink/15 bg-card hover:border-orange"
            }`}
          >
            {STATUS_LABELS[key]}
          </Link>
        ))}
      </nav>

      <section aria-label="Cards" className="mt-6">
        {report.rows.length === 0 ? (
          <p className="border border-ink/15 bg-card px-6 py-8 text-center text-sm text-muted">
            {filter === "all"
              ? "No gift cards sold yet. They appear here the moment a guest pays for one."
              : `No ${STATUS_LABELS[filter].toLowerCase()} cards right now.`}
          </p>
        ) : (
          <div className="overflow-x-auto border border-ink/15 bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">
                Gift cards sold, newest first — code, value, buyer, status and redemption
              </caption>
              <thead>
                <tr className="border-b border-ink/20 text-left text-xs uppercase tracking-wider text-muted">
                  <th scope="col" className="px-4 py-3">
                    Code
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Design
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Value
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Bought by
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Bought
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Expires
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Redeemed
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((card) => (
                  <tr key={card.id} className="border-b border-ink/10 align-top last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left font-mono font-semibold">
                      {card.codeFormatted}
                    </th>
                    <td className="px-4 py-3">{card.productName ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {money(card.valueCents)}
                    </td>
                    <td className="px-4 py-3">
                      {card.buyerName ?? "—"}
                      {card.buyerEmail ? (
                        <span className="block text-xs text-muted">
                          <a
                            href={`mailto:${card.buyerEmail}`}
                            className="underline underline-offset-2"
                          >
                            {card.buyerEmail}
                          </a>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                          STATUS_STYLE[card.status] ?? "bg-ink/10 text-muted"
                        }`}
                      >
                        {STATUS_WORDS[card.status] ?? card.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{date(card.paidAt)}</td>
                    <td className="px-4 py-3 text-muted">{date(card.expiresAt)}</td>
                    <td className="px-4 py-3">{redeemed(card.redemption)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Tile({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="border border-ink/10 bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p
        className={`mt-1 tabular-nums ${strong ? "text-2xl font-bold text-orange" : "text-xl font-semibold"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}
