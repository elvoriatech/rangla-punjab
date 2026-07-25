import { NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookie } from "@/lib/auth";
import { loginUser } from "@/lib/auth-service";
import { clientIp } from "@/lib/client-ip";
import { checkRateLimit, LOGIN_EMAIL, LOGIN_IP } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Per-IP first (cheaper failure mode — no user lookup at all), then
  // per-email. Order matters: an attacker spraying one IP across many
  // accounts hits the IP cap; one attacker across many IPs hits the
  // email cap.
  for (const [cfg, id] of [
    [LOGIN_IP, clientIp(request)] as const,
    [LOGIN_EMAIL, parsed.data.email.trim().toLowerCase()] as const,
  ]) {
    const rl = await checkRateLimit(cfg, id);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
  }

  const result = await loginUser(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await setSessionCookie(result.userId);
  return NextResponse.json({ ok: true });
}
