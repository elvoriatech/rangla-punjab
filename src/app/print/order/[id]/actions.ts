"use server";

import { recordOrderEvent, staffActor } from "@/lib/order-events";
import { internalOrderNumber } from "@/lib/order-label";
import { getKitchenOrder } from "@/lib/order-service";
import { requirePermission } from "@/lib/team-access";
import { getVenueForUser } from "@/lib/venue-service";

/**
 * The ticket page's own Print button was pressed: record the print then
 * (opening the page to look at an order is not a print — owner, 2026-10-23).
 */
export async function recordDashboardPrintAction(orderId: string): Promise<void> {
  const userId = await requirePermission("orders");
  const venue = await getVenueForUser(userId);
  if (!venue.ok) return;
  const order = await getKitchenOrder(userId, orderId);
  if (!order) return;
  await recordOrderEvent({
    tenantId: venue.value.tenantId,
    venueId: venue.value.id,
    orderId: order.id,
    orderLabel: internalOrderNumber(order),
    kind: "order.printed",
    actor: await staffActor(userId),
    summary: "Printed (dashboard)",
  });
}
