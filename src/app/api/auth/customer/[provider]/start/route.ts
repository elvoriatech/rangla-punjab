import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, customerProviders, signState } from "@/lib/customer-auth";

/**
 * GET /api/auth/customer/{google|microsoft|dev}/start[?device=CODE]
 *
 * Kicks off the sign-in: signs the CSRF state (carrying the device-login
 * code when the app started the flow) and redirects to the provider's
 * authorize page — or the local dev-login form for the fake provider.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerId } = await ctx.params;
  const provider = customerProviders().find((p) => p.id === providerId);
  if (!provider) {
    return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  }
  const device = req.nextUrl.searchParams.get("device") ?? undefined;
  const state = signState({ p: provider.id, ...(device ? { d: device } : {}) });
  return NextResponse.redirect(buildAuthorizeUrl(provider, state), 303);
}
