import { NextRequest, NextResponse } from "next/server";
import { formatGiftCardCode, normalizeGiftCardCode } from "@/lib/gift-card-code";
import { giftCardShareUrl } from "@/lib/gift-card-service";
import { verifyGiftCardToken } from "@/lib/gift-card-token";
import { renderQrPng } from "@/lib/qr";
import { asTenant } from "@/lib/tenant";

/**
 * GET /api/gift-cards/{code}/qr?t=… — the card's QR, as a PNG.
 *
 * Two callers: the zero-JS share page (an `<img>`, because the page must
 * work without scripts) and the Expo app, which has no QR renderer of
 * its own — `react-native-qrcode-svg` is not a dependency and adding a
 * native module for one screen would force a rebuild of both binaries.
 *
 * What it encodes is the SHARE URL, not the bare code. A cashier's phone
 * camera then opens a page that shows the card and its status, rather
 * than pasting an opaque string into a search box; and
 * `normalizeGiftCardCode` accepts that URL back, so scanning it into the
 * redeem field also works.
 *
 * Auth is the same HMAC token as the share page. Without it this route
 * would be a code oracle: "does ABCD-EFGH-JKMN exist?" answered 200/404,
 * a few million times.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code: raw } = await ctx.params;
  const token = req.nextUrl.searchParams.get("t");

  const code = normalizeGiftCardCode(decodeURIComponent(raw));
  const verified = token ? verifyGiftCardToken(token) : null;
  if (!code || !verified || verified.code !== code) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The card must exist and be past `pending_payment` — an unpaid
  // purchase has no card to show anyone yet.
  const card = await asTenant(verified.tenantId, (tx) =>
    tx.giftCard.findFirst({ where: { code }, select: { status: true } }),
  );
  if (!card || card.status === "pending_payment") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const png = await renderQrPng(giftCardShareUrl(code, verified.tenantId));
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="gift-card-${formatGiftCardCode(code)}.png"`,
      // Private: the URL carries a bearer token, so no shared cache may
      // keep a copy. Long max-age because the image never changes.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
