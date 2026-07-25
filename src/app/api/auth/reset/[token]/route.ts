import { NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordReset } from "@/lib/verification-service";

const bodySchema = z.object({ password: z.string().min(12).max(1024) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const result = await consumePasswordReset(token, parsed.data.password);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 410 });
  }
  return NextResponse.json({ ok: true });
}
