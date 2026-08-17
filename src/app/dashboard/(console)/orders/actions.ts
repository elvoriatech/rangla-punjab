"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { advanceOrderStatus, markOrderDone } from "@/lib/order-service";

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
