import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/verification-service";
import { clientIp } from "@/lib/client-ip";
import { checkRateLimit, RESET_EMAIL, RESET_IP } from "@/lib/rate-limit";

const bodySchema = z.object({ email: z.string().email().max(254) });

// Always 200 for known/unknown emails alike (see enumeration notes on
// `/verify/request`). Rate limits still apply — 429 is a *different* signal
// than "no such account", so it can't be used as an enumeration oracle.
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  for (const [cfg, id] of [
    [RESET_IP, clientIp(request)] as const,
    [RESET_EMAIL, parsed.data.email.trim().toLowerCase()] as const,
  ]) {
    const rl = await checkRateLimit(cfg, id);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
  }

  await requestPasswordReset(parsed.data.email);
  return NextResponse.json({ ok: true });
}
