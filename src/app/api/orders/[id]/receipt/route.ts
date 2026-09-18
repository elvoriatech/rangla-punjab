import { NextResponse } from "next/server";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getOrderForReceipt } from "@/lib/order-service";
import { buildReceiptPdf } from "@/lib/receipt-pdf";
import { readUpload } from "@/lib/image-storage";
import { resizeImage } from "@/lib/image-resize";
import { isLocaleCode, uiLocale } from "@/lib/locales";

/** Venue logo as small PNG bytes, resized from the stored original with
 *  sharp. Any failure just means a text-only header. */
async function fetchLogoPng(logoKey: string | null): Promise<Uint8Array | null> {
  if (!logoKey) return null;
  try {
    const original = await readUpload(logoKey);
    if (!original) return null;
    return new Uint8Array(await resizeImage(original, 200, "png"));
  } catch {
    return null;
  }
}

/**
 * Receipt PDF for a placed order. The signed token (handed out at order
 * creation) is the whole authorization — no session, no enumeration:
 * a guessed order id without a matching signature is a 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const localeParam = url.searchParams.get("locale");

  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const order = await getOrderForReceipt(verified.tenantId, id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A valid `?locale=` wins; otherwise the venue's own language. Venue
  // locales without a catalogue collapse to English inside `uiLocale`.
  const locale = uiLocale(isLocaleCode(localeParam) ? localeParam : order.venue.defaultLocale);
  const logoPng = await fetchLogoPng(order.venue.logoKey);
  const pdf = await buildReceiptPdf(order, locale, logoPng);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${order.venue.slug}-${order.orderNumber}.pdf"`,
      // Private: the token in the query string must not end up in a
      // shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
