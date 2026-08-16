import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getOrderTracking } from "@/lib/order-service";
import { menuThemeStyle } from "@/lib/menu-themes";
import { guestSteps, stepIndex } from "@/lib/order-status";

/**
 * Guest order tracker — the "Bestellung verfolgen" surface. Server-rendered,
 * zero JS, token-authorized (possession of the receipt link IS the
 * permission), never cached: every load re-reads the live status. Meta
 * refresh keeps a phone left open on the table honest without shipping
 * a polling island.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bestellung verfolgen",
  robots: { index: false },
};

export default async function OrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  const { token } = await searchParams;
  const claim = token ? verifyReceiptToken(token) : null;
  if (!claim || claim.orderId !== orderId) notFound();

  const order = await getOrderTracking(claim.tenantId, orderId);
  if (!order) notFound();

  const branding = (order.venue.branding ?? {}) as Record<string, string | undefined>;
  const themeStyle = menuThemeStyle(
    branding.theme,
    branding.texture,
    branding.backdrop,
    branding.headingColor,
  );

  const steps = guestSteps(order.orderType);
  const current = stepIndex(order.status, order.orderType);
  const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: order.currency });
  const time = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: order.venue.timezone || "Europe/Berlin",
  });
  const isDone = order.status === "done";

  return (
    <main
      style={themeStyle}
      className="flex min-h-screen flex-col items-center bg-[var(--menu-bg)] px-4 py-10 text-[var(--menu-text)]"
    >
      {/* meta refresh: live without JavaScript */}
      {!isDone ? <meta httpEquiv="refresh" content="15" /> : null}
      <div className="w-full max-w-md rounded-2xl border border-[var(--menu-line)] bg-[var(--menu-surface)] p-6 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.5)]">
        <p className="text-center text-xs uppercase tracking-[0.28em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
          Bestellung verfolgen · Order tracking
        </p>
        <h1 className="mt-2 text-center font-serif text-3xl">
          Bestellung #{String(order.orderNumber).padStart(4, "0")}
        </h1>
        <p className="mt-1 text-center text-sm text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
          {time.format(order.createdAt)}
          {order.tableNumber ? ` · Tisch ${order.tableNumber}` : ""}
        </p>

        <ol className="mt-8 space-y-0">
          {steps.map((step, i) => {
            const reached = i <= current;
            const isCurrent = i === current && !isDone;
            return (
              <li key={step.key} className="relative flex gap-4 pb-8 last:pb-0">
                {i < steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5"
                    style={{
                      backgroundColor:
                        reached && i < current ? "var(--menu-positive)" : "var(--menu-line)",
                    }}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
                  style={
                    reached
                      ? {
                          backgroundColor: isCurrent
                            ? "var(--menu-surface-accent, var(--menu-accent))"
                            : "var(--menu-positive)",
                          borderColor: isCurrent
                            ? "var(--menu-surface-accent, var(--menu-accent))"
                            : "var(--menu-positive)",
                          color: "var(--menu-surface, #fff)",
                        }
                      : {
                          borderColor: "var(--menu-line)",
                          color: "var(--menu-surface-text-soft, var(--menu-text-soft))",
                        }
                  }
                >
                  {reached && !isCurrent ? "✓" : i + 1}
                </span>
                <span className="pt-1">
                  <span className={`block text-sm font-semibold ${reached ? "" : "opacity-60"}`}>
                    {step.de}
                  </span>
                  <span className="block text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                    {step.en}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-8 rounded-xl border border-[var(--menu-line)] px-4 py-3 text-sm">
          <ul className="mb-2 space-y-1 border-b border-[var(--menu-line)] pb-2">
            {order.items.map((line, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="min-w-6 font-bold text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {line.quantity}×
                </span>
                <span className="flex-1 truncate">{line.name}</span>
                <span className="tabular-nums text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  {money.format((line.priceCents * line.quantity) / 100)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between">
            <span>Gesamt / Total</span>
            <span className="font-semibold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]">
              {money.format(order.totalCents / 100)}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            <span>Zahlung / Payment</span>
            <span>
              {order.paymentStatus === "paid"
                ? "✓ Online bezahlt"
                : "Zahlung im Restaurant / pay at the restaurant"}
            </span>
          </div>
        </div>

        {!isDone ? (
          <p className="mt-4 text-center text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
            Diese Seite aktualisiert sich automatisch alle 15 Sekunden.
          </p>
        ) : null}
        <p className="mt-2 text-center text-xs">
          <Link href="/" className="underline underline-offset-4">
            Zur Speisekarte / back to the menu
          </Link>
        </p>
      </div>
    </main>
  );
}
