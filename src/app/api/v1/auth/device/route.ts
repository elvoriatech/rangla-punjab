import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { corsPreflight, withCors } from "@/lib/cors";
import { customerProviders } from "@/lib/customer-auth";
import { redis } from "@/lib/redis";
import { checkRateLimit, DEVICE_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { siteUrl } from "@/lib/site-url";

/**
 * POST /api/v1/auth/device — the app's login entry (hand-rolled device
 * flow): mints a short-lived device code, returns the provider login
 * URLs to open in the browser. The callback parks the customer token
 * under the code; the app polls the sibling GET.
 *
 * Optional JSON body `{ app }` — the app's own return deep link. It is
 * parked WITH the code (never in the OAuth state, which travels through
 * the provider) so the callback can look it up and bounce the browser
 * back into the app instead of stranding the guest on a web page. Only
 * app schemes survive `sanitizeAppReturnUrl`; anything else is dropped
 * silently, exactly as an older build that sends no body at all.
 *
 * Rate limited per IP: the endpoint is unauthenticated and every call
 * writes a Redis key, so an open loop here is free storage churn. The
 * ceiling is far above what a guest retrying sign-in can reach.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rl = await checkRateLimit(DEVICE_IP, clientIp(request));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  const appReturn = sanitizeAppReturnUrl(await readAppReturn(request));
  const code =
    randomBytes(9)
      .toString("base64url")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 10) || randomBytes(6).toString("hex");
  await redis.set(
    `customer-device:${code}`,
    JSON.stringify({ status: "pending", ...(appReturn ? { app: appReturn } : {}) }),
    "EX",
    600,
  );
  const providers = customerProviders().map((p) => ({
    id: p.id,
    label: p.label,
    loginUrl: `${siteUrl()}/api/auth/customer/${p.id}/start?device=${code}`,
  }));
  return withCors(NextResponse.json({ ok: true, code, expiresInSeconds: 600, providers }));
}

/** The body is optional: `refreshProviders()` and every build older than
 *  the deep-link return send none at all, and a malformed one must not
 *  cost the guest their sign-in. */
async function readAppReturn(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { app?: unknown } | null;
    return typeof body?.app === "string" ? body.app : null;
  } catch {
    return null;
  }
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
