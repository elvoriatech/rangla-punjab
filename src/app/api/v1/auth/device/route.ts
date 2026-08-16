import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { customerProviders } from "@/lib/customer-auth";
import { redis } from "@/lib/redis";
import { siteUrl } from "@/lib/site-url";

/**
 * POST /api/v1/auth/device — the app's login entry (hand-rolled device
 * flow, no deep links needed): mints a short-lived device code, returns
 * the provider login URLs to open in the system browser. The callback
 * parks the customer token under the code; the app polls the sibling GET.
 */
export async function POST(): Promise<NextResponse> {
  const code =
    randomBytes(9)
      .toString("base64url")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 10) || randomBytes(6).toString("hex");
  await redis.set(`customer-device:${code}`, JSON.stringify({ status: "pending" }), "EX", 600);
  const providers = customerProviders().map((p) => ({
    id: p.id,
    label: p.label,
    loginUrl: `${siteUrl()}/api/auth/customer/${p.id}/start?device=${code}`,
  }));
  return withCors(NextResponse.json({ ok: true, code, expiresInSeconds: 600, providers }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
