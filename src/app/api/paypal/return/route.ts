import { NextRequest, NextResponse } from "next/server";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { finalizePayPalReturn } from "@/lib/paypal-service";
import { siteUrl } from "@/lib/site-url";

/**
 * PayPal return leg. The guest approved (or the fake short-circuited);
 * we capture server-side and bounce onwards in the settled state.
 * Capture is idempotent — refreshing this URL cannot double-pay. The
 * receipt token in `t` is the authorization, exactly like every other
 * anonymous order surface.
 *
 * Where "onwards" is depends on who started the payment:
 *   - from the app (`app=` carries its deep link): the hand-over page
 *     `/auth/app-return`, which throws the browser straight back into
 *     the app. The app was never showing our pay page — it opened
 *     PayPal directly — so bouncing back to it would be a dead end the
 *     guest has to tap out of.
 *   - from the web: the pay page, in its settled state, as before.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const orderId = req.nextUrl.searchParams.get("orderId") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const verified = verifyReceiptToken(token);
  if (!orderId || !verified || verified.orderId !== orderId) {
    return NextResponse.redirect(`${siteUrl()}/`, 303);
  }

  const result = await finalizePayPalReturn(verified.tenantId, orderId);
  const status = result.paid ? "success" : "failed";
  const app = sanitizeAppReturnUrl(req.nextUrl.searchParams.get("app"));
  if (app) {
    return NextResponse.redirect(
      `${siteUrl()}/auth/app-return?to=${encodeURIComponent(app)}&status=${status}`,
      303,
    );
  }
  const payPage = `${siteUrl()}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`;
  return NextResponse.redirect(`${payPage}&status=${status}`, 303);
}
