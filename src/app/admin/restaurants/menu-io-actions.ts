"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { ensureDraftForTenant } from "@/lib/menu-versions-service";
import { parseWorkbook, parseJson, replaceDraft } from "@/lib/menu-io-service";

/**
 * Operator-only bulk menu tools, scoped to one restaurant's tenant. The
 * restaurant owner edits dish-by-dish in their dashboard; the operator does
 * spreadsheet round-trips and bulk photo uploads here. Every action
 * re-checks isPlatformAdmin and operates on the tenantId from the form, so
 * it can only touch the restaurant the operator is looking at.
 */

async function gate(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (!(await isPlatformAdmin(userId))) redirect("/login");
  return userId;
}

function back(tenantId: string, params: string): never {
  redirect(`/admin/restaurants/${tenantId}?${params}`);
}

export async function adminImportMenuAction(form: FormData): Promise<void> {
  await gate();
  const tenantId = String(form.get("tenantId") ?? "");
  if (!tenantId) redirect("/admin/restaurants");
  await ensureDraftForTenant(tenantId);

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back(tenantId, "menu=nofile");

  const buf = Buffer.from(await file.arrayBuffer());
  const isJson = file.name.toLowerCase().endsWith(".json") || file.type.includes("json");
  const parsed = isJson ? parseJson(buf.toString("utf8")) : await parseWorkbook(buf);
  if (parsed.errors.length > 0) back(tenantId, `menu=err&n=${parsed.errors.length}`);

  const res = await replaceDraft(tenantId, parsed.menu);
  if (!res.ok) back(tenantId, "menu=nodraft");

  revalidatePath(`/admin/restaurants/${tenantId}`, "page");
  back(
    tenantId,
    `menu=ok&c=${res.categories}&i=${res.items}&m=${res.imagesMissing.length}&w=${parsed.warnings.length}`,
  );
}
