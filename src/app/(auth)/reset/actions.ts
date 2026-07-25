"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { consumePasswordReset } from "@/lib/verification-service";

const schema = z.object({
  token: z.string().min(10).max(512),
  password: z.string().min(12).max(1024),
  confirm: z.string().min(1).max(1024),
});

/**
 * Set-password server action — the no-JS twin of POST /api/auth/reset/[token].
 * Validates the new password, consumes the single-use token, and (on success)
 * sends the owner to the login page. We do NOT auto-sign-in: consuming the
 * token bumps `sessions_valid_from`, so the cleanest guarantee is that the
 * owner authenticates fresh with the password they just chose. Errors
 * round-trip through the query string so the page renders them without JS.
 */
export async function resetPasswordAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const parsed = schema.safeParse({
    token,
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) {
    redirect(`/reset/${encodeURIComponent(token)}?error=invalid`);
  }
  if (parsed.data.password !== parsed.data.confirm) {
    redirect(`/reset/${encodeURIComponent(parsed.data.token)}?error=mismatch`);
  }
  const result = await consumePasswordReset(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    redirect(`/reset/${encodeURIComponent(parsed.data.token)}?error=invalid_or_expired`);
  }
  redirect("/login?reset=1");
}
