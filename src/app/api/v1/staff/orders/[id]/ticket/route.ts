import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getKitchenOrder } from "@/lib/order-service";
import { renderQrSvg } from "@/lib/qr";
import { requireStaff } from "@/lib/staff-request";
import { renderTicketHtml, ticketAddressLine } from "@/lib/ticket-html";
import { dispatchUrl } from "@/lib/dispatch-service";
import { getVenueForUser } from "@/lib/venue-service";

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
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
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
  const navQrSvg = addressLine
    ? await renderQrSvg(dispatchUrl(order.id, gate.staff.tenantId))
    : null;

  const html = renderTicketHtml(order, { name: venue.value.name }, { navQrSvg });
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
