"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/client-ip";
import { dispatchOrder } from "@/lib/dispatch-service";
import { verifyDispatchToken } from "@/lib/dispatch-token";
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit";

/**
 * The one action behind the driver's button.
 *
 * Deliberately a plain form POST with no client JavaScript: this runs on
 * a phone held in one hand, in a car park, on a connection that may be a
 * single bar. A button that needs a hydrated bundle to work is a button
 * that sometimes does not.
 *
 * The token in the form is the credential and is re-verified here — the
 * page having rendered is not permission, because a form can be replayed
 * from anywhere.
 */

/**
 * Generous, because the legitimate pattern is one driver tapping once
 * per order and occasionally twice. Fail-open so a Redis blip cannot
 * strand food in the kitchen.
 */
const DISPATCH_IP: RateLimitConfig = {
  scope: "dispatch:ip",
  limit: 40,
  windowSec: 60,
  failOpen: true,
};

export async function dispatchAction(form: FormData): Promise<void> {
  const orderId = String(form.get("orderId") ?? "");
  const token = String(form.get("token") ?? "");

  const head = await headers();
  const rl = await checkRateLimit(
    DISPATCH_IP,
    clientIp(new Request("http://local/", { headers: head })),
  );
  if (!rl.ok) redirect(`/dispatch/${orderId}?t=${encodeURIComponent(token)}&e=busy`);

  const verified = verifyDispatchToken(token);
  if (!verified || verified.orderId !== orderId) {
    redirect(`/dispatch/${orderId}?t=${encodeURIComponent(token)}&e=invalid`);
  }

  const result = await dispatchOrder(verified.tenantId, orderId, "dispatch-qr");
  if (!result.ok) {
    redirect(`/dispatch/${orderId}?t=${encodeURIComponent(token)}&e=${result.error}`);
  }

  // Back to the same page in its "on the way" state, which is what
  // carries the route link and the auto-forward to Maps.
  redirect(`/dispatch/${orderId}?t=${encodeURIComponent(token)}&sent=1`);
}
