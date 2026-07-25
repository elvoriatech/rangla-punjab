import { NextResponse } from "next/server";
import { z } from "zod";
import { requestEmailVerification } from "@/lib/verification-service";

const bodySchema = z.object({ email: z.string().email().max(254) });

/**
 * Always responds 200 whether or not the email matches a user. Any signal
 * about existence — status code, response body, timing — is a slow-motion
 * user enumeration oracle. The service function short-circuits internally
 * without sending mail if the account is missing or already verified.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await requestEmailVerification(parsed.data.email);
  return NextResponse.json({ ok: true });
}
