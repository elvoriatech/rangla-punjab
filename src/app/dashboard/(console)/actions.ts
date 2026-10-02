"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie, getSessionUserId } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { ACTIVE_VENUE_COOKIE, listOwnerVenues } from "@/lib/active-venue";
import { isPauseChoice, setOrderingPause } from "@/lib/ordering-pause";
import { requirePermission } from "@/lib/team-access";
import { resolveActiveTenantId } from "@/lib/tenant";

/** Sidebar "Log out" — clears the session cookie and returns to the login
 *  page. Form-driven so it works without JS like the rest of the shell. */
export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

/** Branch switcher: set the dashboard's active venue. The id is validated
 *  against the venues the session user's tenant actually owns before it is
 *  trusted — a forged id can never select another tenant's branch. */
export async function setActiveVenueAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const venueId = String(form.get("venueId") ?? "");
  const owned = await listOwnerVenues(userId);
  if (owned.some((v) => v.id === venueId)) {
    (await cookies()).set(ACTIVE_VENUE_COOKIE, venueId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect("/dashboard");
}

/**
 * The open/closed switch: stop taking orders for 30 minutes, an hour or
 * the rest of the day ("30" | "60" | "day"), or reopen now ("off").
 * Needs the Settings area, like the delivery / pickup switches.
 */
export async function setOrderingPauseAction(form: FormData): Promise<void> {
  const userId = await requirePermission("settings");
  const choice = String(form.get("pause") ?? "");
  const tenantId = await resolveActiveTenantId(userId);
  if (tenantId && (choice === "off" || isPauseChoice(choice))) {
    await setOrderingPause(tenantId, choice);
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath("/", "layout");
}
