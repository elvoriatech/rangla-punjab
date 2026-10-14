import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { recordForOrder, staffActor } from "@/lib/order-events";
import { getKitchenOrder } from "@/lib/order-service";
import { renderQrSvg } from "@/lib/qr";
import { requireStaff } from "@/lib/staff-request";
import { renderTicketEscPos } from "@/lib/ticket-escpos";
import { offerWasCents, renderTicketHtml, ticketAddressLine, ticketMoney } from "@/lib/ticket-html";
import { offerLineRaster } from "@/lib/receipt-raster";
import { ticketLogoDataUri, ticketLogoRaster } from "@/lib/ticket-logo";
import { dispatchUrl } from "@/lib/dispatch-service";
import { getVenueForUser } from "@/lib/venue-service";
import { orderEta } from "@/lib/order-eta";
import { getOrderingConfigForUser } from "@/lib/staff-service";

/**
 * GET /api/v1/staff/orders/{id}/ticket → the 80 mm kitchen ticket, as a
 * complete `text/html` document.
 *
 * The counter tablet prints it with `expo-print`'s `printAsync({ html })`,
 * which is why this answers MARKUP rather than JSON the app would have to
 * template: the ticket's layout is a receipt-roll problem (302 px column,
 * zero page margin, no webfont), it changes when the order model changes,
 * and having it in one place means a released app never prints last
 * quarter's ticket.
 *
 * `getKitchenOrder` is RLS-scoped through `asUser`, so an id belonging to
 * another tenant simply is not there — the 404 is the database's answer,
 * not a check this handler could forget. Errors stay JSON on purpose: a
 * failed print should surface as a refusal in the app, never as a page of
 * apology coming out of the printer.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "orders");
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  // The order log: who printed it, when, and on what.
  void recordForOrder(gate.staff.tenantId, id, {
    kind: "order.printed",
    actor: await staffActor(gate.staff.userId),
    summary:
      req.nextUrl.searchParams.get("format") === "escpos" ? "Printed (Bluetooth)" : "Printed",
  });
  const [venue, order] = await Promise.all([
    getVenueForUser(gate.staff.userId),
    getKitchenOrder(gate.staff.userId, id),
  ]);
  if (!venue.ok || !order) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }

  // The QR encodes our DISPATCH link, not the Maps URL: scanning it
  // flips the order to "out for delivery" and forwards to the same
  // route, so the guest's tracker learns the food left without anyone
  // having to remember to tap the board. `ticketDirectionsUrl` is still
  // the destination — it just lives on the other side of that redirect
  // now (see `dispatch-service.ts`).
  const addressLine = ticketAddressLine(order);
  // The promised time — accepted, or the default once the window ran out.
  const readyAt =
    orderEta(order, await getOrderingConfigForUser(gate.staff.userId))?.expectedAt ?? null;

  // `?format=escpos` — the same ticket as raw receipt-printer bytes
  // (base64 in JSON) for the app's Bluetooth printer, which prints with
  // no dialog. `paper=58|80` picks the column count (owner, 2026-10-09).
  if (req.nextUrl.searchParams.get("format") === "escpos") {
    const paper = req.nextUrl.searchParams.get("paper") === "58" ? 58 : 80;
    const bytes = renderTicketEscPos(
      order,
      { name: venue.value.name },
      {
        paper,
        readyAt,
        logo: await ticketLogoRaster(venue.value.branding.logoKey, paper === 58 ? 160 : 192),
        // Offer lines as pictures, so the old price prints crossed out.
        offerImages: await Promise.all(
          order.items.map((item) => {
            const was = offerWasCents(item);
            return was === null
              ? null
              : offerLineRaster(
                  {
                    left: `${item.quantity}x ${item.name}`,
                    was: ticketMoney(was, order.currency),
                    now: ticketMoney(item.priceCents * item.quantity, order.currency),
                  },
                  paper === 58 ? 384 : 576,
                ).catch(() => null);
          }),
        ),
        navQrData: addressLine ? dispatchUrl(order.id, gate.staff.tenantId) : null,
      },
    );
    return withCors(
      NextResponse.json(
        { ok: true, base64: Buffer.from(bytes).toString("base64") },
        { headers: { "Cache-Control": "private, no-store" } },
      ),
    );
  }

  const navQrSvg = addressLine
    ? await renderQrSvg(dispatchUrl(order.id, gate.staff.tenantId))
    : null;

  const logoDataUri = await ticketLogoDataUri(venue.value.branding.logoKey);
  const html = renderTicketHtml(
    order,
    { name: venue.value.name },
    { navQrSvg, logoDataUri, readyAt },
  );
  return withCors(
    new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Same rule as the rest of the board: the URL carries no identity
        // and a cached ticket is a ticket for someone else's order.
        "Cache-Control": "private, no-store",
      },
    }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
