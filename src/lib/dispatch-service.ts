import { canTransition } from "./order-status";
import { createLogger } from "./logger";
import { uiLocale } from "./locales";
import { captureException } from "./observability";
import { signDispatchToken } from "./dispatch-token";
import { siteUrl } from "./site-url";
import { asTenant } from "./tenant";
import { ticketAddressLine, ticketDirectionsUrl } from "./ticket-html";

/**
 * Driver dispatch.
 *
 * The delivery ticket's QR used to encode a Google Maps directions link,
 * which is useful to the driver and invisible to everyone else: the
 * kitchen still had to remember to tap "out for delivery" on the board,
 * and when they forgot, the guest's tracker sat on "ready" while their
 * food was already in a car.
 *
 * Now the QR encodes OUR url. Scanning it flips the order and THEN
 * forwards to the same Maps route, so the driver's single existing
 * gesture — the one they already make to get directions — is what tells
 * the guest the food is on its way. Nothing was added to the driver's
 * job; the side effect was moved onto the action they already perform.
 *
 * Authorisation is the token in that URL (see `dispatch-token.ts`):
 * possession of the printed ticket. The transition it permits is the
 * narrowest one that does the job, and the kitchen can undo it.
 */

const log = createLogger();

/** Who moved the order, for the log. Not stored on the row — the board
 *  and the dashboard do not record an actor either, and inventing a
 *  column for one of three equal paths would be a half-truth. */
export type DispatchActor = "dispatch-qr" | "staff-app";

export type DispatchResult =
  | {
      ok: true;
      /** True when the order was ALREADY out (or delivered): the scan is
       *  a no-op, not an error. A driver who scans twice, or a second
       *  driver sent to the same address, must see "on the way", not a
       *  failure they will try to work around. */
      already: boolean;
      orderNumber: number;
      /** "B" (cash) / "O" (online); null on older orders. */
      orderSeries?: string | null;
      customerName: string | null;
      addressLine: string | null;
      directionsUrl: string | null;
      status: string;
    }
  | { ok: false; error: "not_found" | "not_delivery" | "wrong_state" };

interface DispatchOrderRow {
  id: string;
  orderNumber: number;
  /** "B" (cash) / "O" (online); null on older orders. */
  orderSeries?: string | null;
  status: string;
  orderType: string;
  customerName: string | null;
  deliveryAddress: unknown;
}

/**
 * `ticketAddressLine` wants the shape the ticket renderer has;
 * `deliveryAddress` comes off Prisma as an untyped JSON value. Narrow it
 * in one place rather than casting at each call, and treat anything that
 * is not an object as "no address" — a malformed blob must degrade to a
 * missing route, never throw on a driver's phone.
 */
function addressLineOf(order: { orderType: string; deliveryAddress: unknown }): string | null {
  const a = order.deliveryAddress;
  const address =
    a && typeof a === "object" && !Array.isArray(a)
      ? (a as { street?: string; zip?: string; city?: string })
      : null;
  return ticketAddressLine({ orderType: order.orderType, deliveryAddress: address });
}

function view(order: DispatchOrderRow, already: boolean, status: string): DispatchResult {
  const addressLine = addressLineOf(order);
  return {
    ok: true,
    already,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    addressLine,
    directionsUrl: addressLine ? ticketDirectionsUrl(addressLine) : null,
    status,
  };
}

/**
 * Read the order behind a dispatch link without changing anything — what
 * the page renders before the driver presses the button.
 */
export async function getDispatchOrder(tenantId: string, orderId: string): Promise<DispatchResult> {
  const order = await asTenant(tenantId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        orderSeries: true,
        status: true,
        orderType: true,
        customerName: true,
        deliveryAddress: true,
      },
    }),
  );
  if (!order) return { ok: false, error: "not_found" };
  if (order.orderType !== "delivery") return { ok: false, error: "not_delivery" };
  return view(order, order.status === "out_for_delivery" || order.status === "done", order.status);
}

/**
 * Move the order out for delivery.
 *
 * Idempotent by the same conditional-`updateMany` compare-and-swap the
 * rest of this codebase uses: two drivers scanning the same ticket at the
 * same second both get `ok`, and exactly one of them wrote the timestamp.
 *
 * A terminal or already-dispatched order is `already: true`, never an
 * error — the person holding the ticket does not care which of them
 * scanned first, they care whether to drive.
 */
export async function dispatchOrder(
  tenantId: string,
  orderId: string,
  actor: DispatchActor,
): Promise<DispatchResult> {
  const outcome = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        orderSeries: true,
        status: true,
        orderType: true,
        customerName: true,
        deliveryAddress: true,
      },
    });
    if (!order) return { ok: false as const, error: "not_found" as const };
    if (order.orderType !== "delivery")
      return { ok: false as const, error: "not_delivery" as const };

    // Already gone (or already delivered): report the state, change nothing.
    if (order.status === "out_for_delivery" || order.status === "done") {
      return { ...view(order, true, order.status), moved: false as const };
    }
    // Any live delivery order goes out on the driver's scan (owner,
    // 2026-10-11: "when the driver scans it should simply put it out for
    // delivery" — the kitchen often never taps "ready"). The QR is only on
    // a ticket, and a ticket prints only once the order was accepted, so
    // the food is on its way to the door. `canTransition` still refuses
    // cancelled and finished orders.
    const dispatchable =
      order.status === "placed" || order.status === "preparing" || order.status === "ready";
    if (!dispatchable || !canTransition(order.status, "out_for_delivery", order.orderType)) {
      return { ok: false as const, error: "wrong_state" as const };
    }

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: "out_for_delivery", outForDeliveryAt: new Date() },
    });
    // Lost the race with another scan — which means the order IS out.
    if (updated.count === 0) {
      return { ...view(order, true, "out_for_delivery"), moved: false as const };
    }
    return { ...view(order, false, "out_for_delivery"), moved: true as const };
  });

  if (outcome.ok && "moved" in outcome && outcome.moved) {
    log.info("order.dispatched", { tenantId, orderId, actor });
    void sendOnTheWayEmail(tenantId, orderId).catch(() => undefined);
  }
  // Strip the internal `moved` flag from what callers see.
  if (outcome.ok) {
    const { ...rest } = outcome as DispatchResult & { moved?: boolean };
    delete (rest as { moved?: boolean }).moved;
    return rest;
  }
  return outcome;
}

/**
 * The driver handed the food over (owner, 2026-10-11: "when the driver
 * hands over the food he can change the order status"). From the same QR
 * page, a second button: the order goes to `done`. Idempotent like the
 * dispatch — a second tap, or an order already done, is `already: true`.
 * An order the driver never marked "on the way" can be delivered straight
 * from placed / preparing / ready too; cancelled stays refused.
 */
export async function deliverOrder(tenantId: string, orderId: string): Promise<DispatchResult> {
  const outcome = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        orderSeries: true,
        status: true,
        orderType: true,
        customerName: true,
        deliveryAddress: true,
      },
    });
    if (!order) return { ok: false as const, error: "not_found" as const };
    if (order.orderType !== "delivery")
      return { ok: false as const, error: "not_delivery" as const };
    if (order.status === "done") return view(order, true, "done");
    if (!canTransition(order.status, "done", order.orderType)) {
      return { ok: false as const, error: "wrong_state" as const };
    }
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: "done",
        ...(order.status === "out_for_delivery" ? {} : { outForDeliveryAt: new Date() }),
      },
    });
    return view(order, updated.count === 0, "done");
  });
  if (outcome.ok && !outcome.already) log.info("order.delivered", { tenantId, orderId });
  return outcome;
}

/** The scan's destination once the order has moved: the same Maps route
 *  the QR used to point at directly. */
export function dispatchUrl(orderId: string, tenantId: string): string {
  return `${siteUrl()}/dispatch/${orderId}?t=${signDispatchToken(orderId, tenantId)}`;
}

/**
 * "Your order is on the way" — one short mail to the guest, at the
 * moment the food leaves.
 *
 * Fire-and-forget and dynamically imported, like every other mail in
 * this codebase: JSX must not enter a service's module graph, and an
 * email failure must never roll back a status the driver already acted
 * on. Sent only from the two places that perform a REAL transition, so
 * it goes out exactly once.
 */
export async function sendOnTheWayEmail(tenantId: string, orderId: string): Promise<void> {
  try {
    const data = await asTenant(tenantId, (tx) =>
      tx.order.findFirst({
        where: { id: orderId },
        select: {
          orderNumber: true,
          orderSeries: true,
          orderType: true,
          customerEmail: true,
          customerName: true,
          deliveryAddress: true,
          customer: { select: { locale: true } },
          venue: { select: { name: true, defaultLocale: true, branding: true } },
        },
      }),
    );
    if (!data?.customerEmail) return;

    const locale = uiLocale(data.customer?.locale ?? data.venue.defaultLocale);
    const branding = (data.venue.branding ?? {}) as Record<string, unknown>;
    const { sendEmail } = await import("./email");
    const { OnTheWayEmail, onTheWaySubject } = await import("@/emails/on-the-way-email");

    await sendEmail({
      to: data.customerEmail,
      subject: onTheWaySubject(locale, data.orderNumber),
      react: OnTheWayEmail({
        venue: {
          name: data.venue.name,
          logoKey: typeof branding.logoKey === "string" ? branding.logoKey : null,
          bannerKey: typeof branding.bannerKey === "string" ? branding.bannerKey : null,
          primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : null,
        },
        locale,
        orderNumber: data.orderNumber,
        customerName: data.customerName,
        addressLine: addressLineOf(data),
      }),
    });
    log.info("order.on_the_way_emailed", { tenantId, orderId });
  } catch (err) {
    captureException(err, { tenantId, orderId, where: "on-the-way-email" });
    log.warn("order.on_the_way_email_failed", { tenantId, orderId });
  }
}
