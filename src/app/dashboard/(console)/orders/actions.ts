"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteCancelledOrder } from "@/lib/order-delete-service";
import { advanceOrderStatus, markOrderDone } from "@/lib/order-service";
import { replyToIssue, resolveIssue } from "@/lib/issue-service";
import { requirePermission } from "@/lib/team-access";

export async function markDoneAction(form: FormData): Promise<void> {
  const userId = await requirePermission("orders");

  const orderId = String(form.get("orderId") ?? "");
  if (orderId) await markOrderDone(userId, orderId);
  revalidatePath("/dashboard/orders", "page");
  revalidatePath("/kitchen", "page");
}

/** Advance an order one step (or skip ahead) along the lifecycle. */
export async function advanceOrderAction(form: FormData): Promise<void> {
  const userId = await requirePermission("orders");

  const orderId = String(form.get("orderId") ?? "");
  const to = String(form.get("to") ?? "");
  if (orderId && to) await advanceOrderStatus(userId, orderId, to);
  revalidatePath("/dashboard/orders", "page");
  revalidatePath("/kitchen", "page");
}

/** Both sides of the complaint thread refresh the same two surfaces: the
 *  thread page the owner is looking at, and the orders list whose pills
 *  and header count come off the same statuses. */
function revalidateIssue(orderId: string): void {
  revalidatePath("/dashboard/orders", "page");
  if (orderId) revalidatePath(`/dashboard/orders/${orderId}/issue`, "page");
}

/** The restaurant's answer on a complaint thread (status → answered). */
export async function replyIssueAction(form: FormData): Promise<void> {
  const userId = await requirePermission("orders");

  const issueId = String(form.get("issueId") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  // An empty box is a mis-click, not an error page: the service would
  // reject it anyway, so nothing is written and the page simply reloads.
  const body = String(form.get("body") ?? "").trim();
  if (issueId && body) await replyToIssue(userId, issueId, body);
  revalidateIssue(orderId);
}

/** Close the thread. The guest can still read it; only the restaurant
 *  may write on it afterwards. */
export async function resolveIssueAction(form: FormData): Promise<void> {
  const userId = await requirePermission("orders");

  const issueId = String(form.get("issueId") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  if (issueId) await resolveIssue(userId, issueId);
  revalidateIssue(orderId);
}

/**
 * Delete a cancelled order on which no money moved — owner only, with a
 * written reason that is kept in the deletion log. Every rule is enforced
 * in the service; this only carries the form and reports the outcome.
 */
export async function deleteOrderAction(form: FormData): Promise<void> {
  const userId = await requirePermission("orders");

  const orderId = String(form.get("orderId") ?? "");
  const reason = String(form.get("reason") ?? "");
  const result = await deleteCancelledOrder(userId, orderId, reason);
  revalidatePath("/dashboard/orders", "page");
  revalidatePath("/dashboard/reports", "page");
  revalidatePath("/kitchen", "page");
  redirect(
    result.ok
      ? `/dashboard/orders?deleted=${result.orderNumber}`
      : `/dashboard/orders?delete_error=${result.error}`,
  );
}
