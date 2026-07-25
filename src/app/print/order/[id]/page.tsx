import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { fulfilmentLines } from "@/lib/ordering-config";
import { getKitchenOrder } from "@/lib/order-service";
import { getVenueForUser } from "@/lib/venue-service";
import { formatPrice } from "@/lib/public-menu";
import { PrintControls } from "./print-controls";

/**
 * Printable kitchen ticket — deliberately outside the dashboard shell so
 * nothing but the 80 mm ticket lands on paper. `?auto=1` opens the print
 * dialog immediately (Print buttons + the auto-print iframes use it).
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
          <p className="mt-0.5 font-bold">** PAID ONLINE **</p>
        ) : null}
        {fulfilmentLines(order).map((line) => (
          <p key={line} className="mt-0.5 font-bold">
            {line}
          </p>
        ))}
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
        <p className="mt-2 text-center text-[11px]">Payment at the restaurant.</p>

        <PrintControls auto={auto === "1"} />
      </div>
    </div>
  );
}
