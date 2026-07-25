"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSessionCookie } from "@/lib/auth";
import { loginUser } from "@/lib/auth-service";
import { clientIp } from "@/lib/client-ip";
import { venueAdminBase } from "@/lib/venue-service";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { checkRateLimit, LOGIN_EMAIL, LOGIN_IP } from "@/lib/rate-limit";

const formSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

/**
 * Login server action — the no-JS twin of `POST /api/auth/login`. Same
 * validation, same rate limits, same service call; only the transport
 * differs (form post + redirect instead of JSON). Errors round-trip
 * through the query string so the page can render them without client JS.
 */
export async function loginAction(form: FormData): Promise<void> {
  const parsed = formSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid");

  // Server actions don't receive the Request, but headers() carries the
  // same proxy headers — wrap them so the shared trust-boundary logic in
  // clientIp() stays the single source of truth.
  const ip = clientIp(new Request("http://action.local", { headers: await headers() }));
  for (const [cfg, id] of [
    [LOGIN_IP, ip] as const,
    [LOGIN_EMAIL, parsed.data.email.trim().toLowerCase()] as const,
  ]) {
    const rl = await checkRateLimit(cfg, id);
    if (!rl.ok) redirect("/login?error=rate_limited");
  }

  const result = await loginUser(parsed.data.email, parsed.data.password);
  if (!result.ok) redirect("/login?error=invalid_credentials");

  await setSessionCookie(result.userId);
  // Guesto staff land on the platform console; owners on their venue.
  if (await isPlatformAdmin(result.userId)) redirect("/admin");
  const base = await venueAdminBase(result.userId);
  redirect(base ?? "/dashboard");
}
