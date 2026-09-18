import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getKitchenOrder } from "@/lib/order-service";
import { getVenueForUser } from "@/lib/venue-service";
import { formatPrice } from "@/lib/public-menu";
import { renderQrSvg } from "@/lib/qr";
import { PrintControls } from "./print-controls";

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
  const addressLine =
    order.orderType === "delivery" && a?.street
      ? [a.street, [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
      : null;
  // Universal Maps directions link: opens turn-by-turn navigation from any
  // phone camera — no app account needed.
  const navQr = addressLine
    ? await renderQrSvg(
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine)}&travelmode=driving`,
      )
    : null;

  const typeBanner =
    order.orderType === "delivery"
      ? "LIEFERUNG / DELIVERY"
      : order.orderType === "takeaway"
        ? "ABHOLUNG / PICKUP"
        : `IM RESTAURANT${order.tableNumber ? ` — TISCH ${order.tableNumber}` : ""}`;

  // ASCII labels, not emoji: thermal printers print them reliably.
  const infoRows: { icon: string; text: string; bold?: boolean }[] = [
    ...(order.requestedFor
      ? [{ icon: "ZEIT", text: `Geplant für ${clock.format(order.requestedFor)} Uhr`, bold: true }]
      : []),
    ...(order.customerName ? [{ icon: "NAME", text: order.customerName }] : []),
    ...(order.customerPhone ? [{ icon: "TEL", text: order.customerPhone }] : []),
    ...(addressLine ? [{ icon: "ADR", text: addressLine }] : []),
    ...(order.orderType === "delivery" && a?.note ? [{ icon: "INFO", text: a.note }] : []),
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
            ** PAID ONLINE{order.paymentProvider === "paypal" ? " (PAYPAL)" : " (CARD)"} **
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
                <span className="w-11 shrink-0 font-bold">{row.icon}:</span>
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
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatPrice(order.totalCents, order.currency, "de")}</span>
        </div>
        <p className="mt-2 text-center text-[11px]">
          {order.paymentStatus === "paid"
            ? `Paid online via ${order.paymentProvider === "paypal" ? "PayPal" : "card"} — nothing to collect.`
            : order.paymentStatus === "pending"
              ? "Online payment NOT confirmed yet — do not hand out; wait for the paid ticket."
              : "Payment at the restaurant."}
        </p>

        <PrintControls auto={auto === "1"} />
      </div>
    </div>
  );
}
