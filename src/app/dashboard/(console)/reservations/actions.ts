"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { setReservationStatus } from "@/lib/reservation-service";

const path = "/dashboard/reservations";

/** Confirm / decline / cancel one reservation. */
export async function setReservationStatusAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  const result = await setReservationStatus(userId, id, status);
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=${status}` : `${path}?error=1`);
}
