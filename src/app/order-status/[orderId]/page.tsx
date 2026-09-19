import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getOrderTracking } from "@/lib/order-service";
import { menuThemeStyle } from "@/lib/menu-themes";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { isLocaleCode, uiLocale } from "@/lib/locales";
import { asTenant } from "@/lib/tenant";
import { getGuestIssueState } from "@/lib/issue-service";
import { OrderTrackerCard } from "./tracker-card";
import { IssueSection } from "./issue-section";
import { reportIssueAction } from "./actions";

/**
 * Guest order tracker. Server-rendered, zero JS, token-authorized
 * (possession of the receipt link IS the permission), never cached: every
 * load re-reads the live status.
 *
 * Language (plan decision 5): `?locale=` when the link carries a valid one
 * — the confirmation sheet, the receipt email and the app all append it —
 * otherwise the venue's default locale. ONE language on screen; the render
 * itself lives in `tracker-card.tsx`.
 */

export const dynamic = "force-dynamic";

/** The venue's own language, for links that arrived without `?locale=`.
 *  `getOrderTracking` doesn't select it, and this extra scoped read only
 *  runs for those bare links. */
async function venueDefaultLocale(tenantId: string, orderId: string): Promise<string | null> {
  const row = await asTenant(tenantId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: { venue: { select: { defaultLocale: true } } },
    }),
  );
  return row?.venue.defaultLocale ?? null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}): Promise<Metadata> {
  const { locale } = await searchParams;
  return { title: postOrderCopy(locale).trackTitle, robots: { index: false } };
}

export default async function OrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string; locale?: string; issue?: string; compose?: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  const {
    token,
    locale: localeParam,
    issue: issueResult,
    compose: composeParam,
  } = await searchParams;
  // `?compose=1` is the guest opening the complaint box. It is also what
  // switches the tracker's 15-second meta refresh off, so a half-typed
  // message survives; the action's redirect drops it again.
  const composing = composeParam === "1";
  const claim = token ? verifyReceiptToken(token) : null;
  // `!token` is redundant with `!claim` at runtime — it is there so the
  // token is a `string` below, where the issue section echoes it into the
  // form and into every photo URL.
  if (!token || !claim || claim.orderId !== orderId) notFound();

  const order = await getOrderTracking(claim.tenantId, orderId);
  if (!order) notFound();

  const locale = uiLocale(
    isLocaleCode(localeParam) ? localeParam : await venueDefaultLocale(claim.tenantId, orderId),
  );

  const branding = (order.venue.branding ?? {}) as Record<string, string | undefined>;
  const themeStyle = menuThemeStyle(
    branding.theme,
    branding.texture,
    branding.backdrop,
    branding.headingColor,
  );

  // The complaint thread lives on the same page, below the tracker: the
  // guest already has the link in their hand, so reporting a problem must
  // not need a second one.
  const issueState = await getGuestIssueState(claim.tenantId, orderId);

  return (
    <>
      <OrderTrackerCard
        locale={locale}
        themeStyle={themeStyle}
        pauseRefresh={composing}
        order={{
          orderNumber: order.orderNumber,
          status: order.status,
          orderType: order.orderType,
          paymentStatus: order.paymentStatus,
          paymentProvider: order.paymentProvider,
          discountCents: order.discountCents,
          totalCents: order.totalCents,
          currency: order.currency,
          createdAt: order.createdAt,
          tableNumber: order.tableNumber,
          timezone: order.venue.timezone,
          items: order.items,
        }}
      />
      {issueState ? (
        <IssueSection
          locale={locale}
          themeStyle={themeStyle}
          orderId={orderId}
          token={token}
          timezone={order.venue.timezone}
          state={issueState}
          result={issueResult ?? null}
          action={reportIssueAction}
          compose={composing}
          liveTracking={order.status !== "done"}
        />
      ) : null}
    </>
  );
}
