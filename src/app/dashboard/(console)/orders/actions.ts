"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { advanceOrderStatus, markOrderDone } from "@/lib/order-service";
import { replyToIssue, resolveIssue } from "@/lib/issue-service";

export async function markDoneAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const orderId = String(form.get("orderId") ?? "");
  if (orderId) await markOrderDone(userId, orderId);
  revalidatePath("/dashboard/orders", "page");
  revalidatePath("/kitchen", "page");
}

/** Advance an order one step (or skip ahead) along the lifecycle. */
export async function advanceOrderAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

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
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

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
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const issueId = String(form.get("issueId") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  if (issueId) await resolveIssue(userId, issueId);
  revalidateIssue(orderId);
}
