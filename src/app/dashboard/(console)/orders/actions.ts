"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { markOrderDone } from "@/lib/order-service";

export async function markDoneAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const orderId = String(form.get("orderId") ?? "");
  if (orderId) await markOrderDone(userId, orderId);
  revalidatePath("/dashboard/orders", "page");
  revalidatePath("/kitchen", "page");
}
