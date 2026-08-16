import { NextRequest, NextResponse } from "next/server";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { finalizePayPalReturn } from "@/lib/paypal-service";
import { siteUrl } from "@/lib/site-url";

/**
 * PayPal return leg. The guest approved (or the fake short-circuited);
 * we capture server-side and bounce to the pay page in the settled
 * state. Capture is idempotent — refreshing this URL cannot double-pay.
 * The receipt token in `t` is the authorization, exactly like every
 * other anonymous order surface.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const orderId = req.nextUrl.searchParams.get("orderId") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const verified = verifyReceiptToken(token);
  if (!orderId || !verified || verified.orderId !== orderId) {
    return NextResponse.redirect(`${siteUrl()}/`, 303);
  }

  const result = await finalizePayPalReturn(verified.tenantId, orderId);
  const app = sanitizeAppReturnUrl(req.nextUrl.searchParams.get("app"));
  const appParam = app ? `&app=${encodeURIComponent(app)}` : "";
  const payPage = `${siteUrl()}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`;
  return NextResponse.redirect(
    `${payPage}&status=${result.paid ? "success" : "failed"}${appParam}`,
    303,
  );
}
