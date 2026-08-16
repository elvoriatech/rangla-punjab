"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { updateVenueAppearance, venueAdminBase } from "@/lib/venue-service";
import { createLogger } from "@/lib/logger";

const log = createLogger();

/**
 * Save the menu theme + texture. Form-driven (radio groups), no JS
 * required. Invalid ids are rejected by the service's zod enum — a forged
 * value can't land in the branding JSON.
 */
export async function saveAppearanceAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const theme = String(form.get("theme") ?? "");
  const texture = String(form.get("texture") ?? "");
  const backdrop = String(form.get("backdrop") ?? "none");
  // Heading color: "default" clears it; "custom" reads the color input;
  // anything else is a preset hex chip. Invalid values fall back to default.
  const headingChoice = String(form.get("headingColor") ?? "default");
  const headingCustom = String(form.get("headingColorCustom") ?? "");
  const headingRaw = headingChoice === "custom" ? headingCustom : headingChoice;
  const headingColor = /^#[0-9a-fA-F]{6}$/.test(headingRaw) ? headingRaw : undefined;
  const categoryIcons = String(form.get("categoryIcons") ?? "names");
  const navLayout = String(form.get("navLayout") ?? "top");
  const kiosk = String(form.get("kiosk") ?? "lg");
  const result = await updateVenueAppearance(userId, {
    theme,
    texture,
    backdrop,
    headingColor,
    categoryIcons,
    navLayout,
    kiosk,
  });
  // Every appearance write is logged — theme changes are guest-visible,
  // and an unexpected value here is the first place to look.
  log.info("appearance.saved", { userId, theme, texture, ok: result.ok });

  const { purgeMenuForUser } = await import("@/lib/cdn-purge");
  if (result.ok) await purgeMenuForUser(userId);
  revalidatePath("/dashboard/appearance", "page");
  revalidatePath("/dashboard", "page");
  const path = `${(await venueAdminBase(userId)) ?? "/dashboard"}/appearance`;
  redirect(result.ok ? `${path}?saved=1` : `${path}?error=1`);
}
