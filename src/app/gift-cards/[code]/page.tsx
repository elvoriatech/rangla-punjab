import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normalizeGiftCardCode } from "@/lib/gift-card-code";
import { openGiftCardShare } from "@/lib/gift-card-service";
import { verifyGiftCardToken } from "@/lib/gift-card-token";
import { giftCardPageCopy } from "@/lib/i18n/gift-card";
import { isLocaleCode, uiLocale } from "@/lib/locales";
import { menuThemeStyle } from "@/lib/menu-themes";
import { asTenant } from "@/lib/tenant";
import { GiftCardShareCard } from "./share-card";

/**
 * The gift-card share page: the link a buyer forwards to whoever they are
 * gifting.
 *
 * Server-rendered, zero JS, token-authorized (possession of the link IS
 * the permission), never cached — a card redeemed at the counter two
 * minutes ago must not still read "ready to use" on the recipient's phone.
 *
 * The token is the ONLY authorization and it is minted for exactly one
 * code, so a mismatch between the token's code and the path's is a 404
 * rather than a redirect: this route must never confirm that some other
 * code exists. `pending_payment` is a 404 for the same reason in reverse —
 * an abandoned purchase has nothing to show anyone.
 *
 * Language: `?locale=` when the link carries a valid one (the buyer's
 * email and the app both append it), otherwise the venue's default —
 * exactly what the order tracker does.
 */

export const dynamic = "force-dynamic";

/** The venue's language, zone and theme. `openGiftCardShare` returns a
 *  card view, not a venue, and this scoped read is what lets the page
 *  wear the restaurant's own colours. */
async function shareVenue(
  tenantId: string,
  code: string,
): Promise<{ defaultLocale: string; timezone: string; branding: unknown } | null> {
  const row = await asTenant(tenantId, (tx) =>
    tx.giftCard.findFirst({
      where: { code },
      select: { venue: { select: { defaultLocale: true, timezone: true, branding: true } } },
    }),
  );
  return row?.venue ?? null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}): Promise<Metadata> {
  const { locale } = await searchParams;
  return {
    title: giftCardPageCopy(locale).title,
    // A bearer link. Indexing it would publish a spendable code, so this
    // page is out of every crawler's reach, links included.
    robots: { index: false, follow: false },
  };
}

export default async function GiftCardSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string; locale?: string }>;
}): Promise<React.ReactElement> {
  const { code: rawCode } = await params;
  const { t: token, locale: localeParam } = await searchParams;

  const code = normalizeGiftCardCode(decodeURIComponent(rawCode));
  const verified = token ? verifyGiftCardToken(token) : null;
  // `!token` is redundant with `!verified` at runtime — it is there so the
  // token is a `string` below, where the card echoes it into the QR URL.
  if (!token || !code || !verified || verified.code !== code) notFound();

  // Also stamps `sharedAt` the first time, which is the "link opened" step
  // of the timeline, and returns null for an unpaid card.
  const card = await openGiftCardShare(verified.tenantId, code);
  if (!card) notFound();

  const venue = await shareVenue(verified.tenantId, code);
  const locale = uiLocale(isLocaleCode(localeParam) ? localeParam : (venue?.defaultLocale ?? null));

  const branding = (venue?.branding ?? {}) as Record<string, string | undefined>;
  const themeStyle = menuThemeStyle(
    branding.theme,
    branding.texture,
    branding.backdrop,
    branding.headingColor,
  );

  return (
    <GiftCardShareCard
      card={card}
      locale={locale}
      themeStyle={themeStyle}
      timezone={venue?.timezone ?? "Europe/Berlin"}
      token={token}
    />
  );
}
