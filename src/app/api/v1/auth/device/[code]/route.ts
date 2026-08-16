import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { redis } from "@/lib/redis";

/**
 * GET /api/v1/auth/device/{code} — the app's login poll. `pending` until
 * the browser flow completes; then the customer token, exactly once
 * (collected = deleted, so a leaked code is worthless afterwards).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await ctx.params;
  if (!/^[a-z0-9-]{4,40}$/i.test(code)) {
    return withCors(NextResponse.json({ ok: false, error: "invalid_code" }, { status: 400 }));
  }
  const raw = await redis.get(`customer-device:${code}`);
  if (!raw) {
    return withCors(NextResponse.json({ ok: false, error: "expired" }, { status: 404 }));
  }
  const entry = JSON.parse(raw) as { status: string };
  if (entry.status !== "ok") {
    return withCors(NextResponse.json({ ok: true, status: "pending" }));
  }
  await redis.del(`customer-device:${code}`);
  return withCors(
    NextResponse.json(
      { ok: true, status: "ok", ...(entry as object) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
