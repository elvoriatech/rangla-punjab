import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getKitchenOrder } from "@/lib/order-service";
import { getVenueForUser } from "@/lib/venue-service";
import { formatPrice } from "@/lib/public-menu";
import { renderQrSvg } from "@/lib/qr";
import { ticketAddressLine, ticketDirectionsUrl } from "@/lib/ticket-html";
import { PrintControls } from "./print-controls";

// Material icon paths (24×24) for the ticket's info rows.
const GLYPHS = {
  phone:
    "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  person:
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  table:
    "M21.96 9.73l-1.43-5C20.41 4.3 20.02 4 19.6 4H4.4c-.42 0-.81.3-.93.73l-1.43 5c-.18.63.3 1.27.96 1.27h2.2L4 20h2l.67-5h10.67l.66 5h2l-1.2-9H21c.66 0 1.14-.64.96-1.27zM6.93 13l.27-2h9.6l.27 2H6.93z",
  note: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z",
} as const;

/**
 * Printable kitchen ticket — deliberately outside the dashboard shell so
 * nothing but the 80 mm ticket lands on paper. `?auto=1` opens the print
 * dialog immediately (Print buttons + the auto-print iframes use it).
 *
 * Delivery tickets carry a QR of a Google-Maps directions link: the
 * driver scans it with any phone camera and navigation opens — no app,
 * no login, no typing the address.
 */

export const metadata = { title: "Order ticket" };

export default async function OrderTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const { id } = await params;
  const { auto } = await searchParams;
  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) notFound();
  const venueName = venueResult.value.name;
  const order = await getKitchenOrder(userId, id);
  if (!order) notFound();

  const time = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  const clock = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  const a = order.deliveryAddress;
  // Shared with the app's `/api/v1/staff/orders/{id}/ticket` renderer, so
  // the address a driver navigates to is the address printed above the QR
  // on both surfaces.
  const addressLine = ticketAddressLine(order);
  const navQr = addressLine ? await renderQrSvg(ticketDirectionsUrl(addressLine)) : null;

  const typeBanner =
    order.orderType === "delivery"
      ? "LIEFERUNG / DELIVERY"
      : order.orderType === "takeaway"
        ? "ABHOLUNG / PICKUP"
        : `IM RESTAURANT${order.tableNumber ? ` — TISCH ${order.tableNumber}` : ""}`;

  // Vector glyphs, not emoji: thermal drivers print SVG as graphics but
  // choke on colour emoji fonts. `icon` is the ASCII word kept as the
  // glyph's accessible label.
  const infoRows: { icon: string; glyph: keyof typeof GLYPHS; text: string; bold?: boolean }[] = [
    ...(order.requestedFor
      ? [
          {
            icon: "ZEIT",
            glyph: "clock" as const,
            text: `Geplant für ${clock.format(order.requestedFor)} Uhr`,
            bold: true,
          },
        ]
      : []),
    ...(order.customerName
      ? [{ icon: "NAME", glyph: "person" as const, text: order.customerName }]
      : []),
    ...(order.customerPhone
      ? [{ icon: "TEL", glyph: "phone" as const, text: order.customerPhone }]
      : []),
    ...(addressLine ? [{ icon: "ADR", glyph: "pin" as const, text: addressLine }] : []),
    ...(order.orderType === "delivery" && a?.note
      ? [{ icon: "INFO", glyph: "note" as const, text: a.note }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-white py-8 text-black print:py-0">
      <div className="mx-auto w-[302px] px-3 font-mono text-[13px] leading-snug">
        <p className="text-center text-sm font-bold uppercase">{venueName}</p>
        <p className="mt-1 text-center text-xs">Kitchen ticket</p>
        <p className="my-2 overflow-hidden whitespace-nowrap">
          --------------------------------------
        </p>
        <div className="flex justify-between font-bold">
          <span>#{String(order.orderNumber).padStart(4, "0")}</span>
          <span>{time.format(order.createdAt)}</span>
        </div>
        {order.paymentStatus === "paid" ? (
          <p className="mt-0.5 font-bold">
            {order.paymentProvider === "voucher"
              ? "** MIT GUTSCHEIN BEZAHLT / PAID WITH REWARD **"
              : `** PAID ONLINE${order.paymentProvider === "paypal" ? " (PAYPAL)" : " (CARD)"} **`}
          </p>
        ) : order.paymentStatus === "pending" ? (
          <p className="mt-0.5 font-bold">** ONLINE PAYMENT PENDING **</p>
        ) : null}

        <p className="mt-2 border-y-2 border-black py-1 text-center text-sm font-bold tracking-wider">
          {typeBanner}
        </p>

        {infoRows.length > 0 ? (
          <div className="mt-2 space-y-1">
            {infoRows.map((row) => (
              <p
                key={`${row.icon}${row.text}`}
                className={row.bold ? "flex gap-2 font-bold" : "flex gap-2"}
              >
                {/* Icon only — the glyph says name / phone / address on its
                    own; the ASCII word stays as the accessible label. */}
                <span className="flex w-5 shrink-0 items-start justify-center pt-0.5">
                  <svg viewBox="0 0 24 24" width="14" height="14" role="img" aria-label={row.icon}>
                    <path d={GLYPHS[row.glyph]} fill="currentColor" />
                  </svg>
                </span>
                <span className="min-w-0 break-words">{row.text}</span>
              </p>
            ))}
          </div>
        ) : null}

        {navQr ? (
          <div className="mt-3 flex flex-col items-center gap-1">
            <div
              className="h-[140px] w-[140px] [&_svg]:h-full [&_svg]:w-full"
              // Server-rendered by our own qr lib from the venue's stored
              // address — no user-controlled markup.
              dangerouslySetInnerHTML={{ __html: navQr }}
            />
            <p className="text-center text-[11px] font-bold uppercase tracking-wider">
              &gt;&gt; Scan für Navigation &lt;&lt;
            </p>
          </div>
        ) : null}

        <p className="my-2 overflow-hidden whitespace-nowrap">
          --------------------------------------
        </p>
        <ul className="space-y-1">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>
                <span className="font-bold">{item.quantity}x</span> {item.name}
              </span>
              <span className="whitespace-nowrap">
                {formatPrice(item.priceCents * item.quantity, order.currency, "de")}
              </span>
            </li>
          ))}
        </ul>
        <p className="my-2 overflow-hidden whitespace-nowrap">
          --------------------------------------
        </p>
        {/* The dishes keep their menu prices; the reward comes off here, so
            the ticket's arithmetic matches the till. */}
        {order.discountCents > 0 ? (
          <div className="flex justify-between">
            <span>GUTSCHEIN / REWARD</span>
            <span>-{formatPrice(order.discountCents, order.currency, "de")}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatPrice(order.totalCents, order.currency, "de")}</span>
        </div>
        <p className="mt-2 text-center text-[11px]">
          {order.paymentStatus === "paid"
            ? order.paymentProvider === "voucher"
              ? "Mit Treuegutschein bezahlt / paid with a loyalty reward — nothing to collect."
              : `Paid online via ${order.paymentProvider === "paypal" ? "PayPal" : "card"} — nothing to collect.`
            : order.paymentStatus === "pending"
              ? "Online payment NOT confirmed yet — do not hand out; wait for the paid ticket."
              : "Payment at the restaurant."}
        </p>

        <PrintControls auto={auto === "1"} />
      </div>
    </div>
  );
}
