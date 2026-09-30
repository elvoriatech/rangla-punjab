"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { setCateringStatus } from "@/lib/catering-service";
import { requirePermission } from "@/lib/team-access";

const path = "/dashboard/catering";

/** Confirm / decline / cancel one catering enquiry. */
export async function setCateringStatusAction(form: FormData): Promise<void> {
  const userId = await requirePermission("catering");
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  const result = await setCateringStatus(userId, id, status);
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=${status}` : `${path}?error=1`);
}
