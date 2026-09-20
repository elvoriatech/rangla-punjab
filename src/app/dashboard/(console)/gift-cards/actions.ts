"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { redeemGiftCardAtCounter } from "@/lib/gift-card-service";
import { getVenueForUser } from "@/lib/venue-service";

const path = "/dashboard/gift-cards";

/**
 * Take a card at the counter: staff type the code off the card the guest
 * is holding, the whole value is spent, and the card is dead.
 *
 * The outcome comes back NAMED (`?error=expired`, `?error=already_redeemed`)
 * rather than as a bare failure, because the answers are different
 * conversations to have with a guest standing at the till — "this was used
 * on the 4th" is not "I can't read that code".
 *
 * The code never rides in the redirect. It is a bearer instrument: a
 * redirect URL lands in the browser history, the access log and any proxy
 * in between, and that is not somewhere a spendable code belongs. The
 * success banner says what happened; the row in the table below says which
 * card it happened to.
 */
export async function redeemGiftCardAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");

  const result = await redeemGiftCardAtCounter(
    venueResult.value.tenantId,
    String(form.get("code") ?? ""),
    userId,
    String(form.get("note") ?? ""),
  );

  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=redeemed` : `${path}?error=${result.error}`);
}
