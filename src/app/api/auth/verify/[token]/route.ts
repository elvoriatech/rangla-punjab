import { NextResponse } from "next/server";
import { consumeEmailVerification } from "@/lib/verification-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const result = await consumeEmailVerification(token);
  if (!result.ok) {
    // 410 Gone: reused, expired, or bogus tokens are indistinguishable —
    // no oracle for "your token was correct but stale".
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 410 });
  }
  return NextResponse.json({ ok: true });
}
