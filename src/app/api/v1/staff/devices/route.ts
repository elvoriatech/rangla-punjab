import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { EXPO_PUSH_TOKEN_RE, registerStaffDevice, unregisterStaffDevice } from "@/lib/push-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST   /api/v1/staff/devices  { token, platform, appVersion? } → { ok: true }
 * DELETE /api/v1/staff/devices  { token }                        → { ok: true }
 *
 * Where the restaurant's phone says "buzz me". The app calls POST after
 * the notification permission is granted (and again on every staff
 * sign-in, so a rotated token is picked up), and DELETE on sign-out.
 *
 * Both answer `{ ok: true }` for an already-registered or
 * already-forgotten token: the app retries these on flaky connections and
 * a 404 for "you already told me" would only teach it to ignore errors.
 *
 * The token shape is validated here rather than at the provider because a
 * malformed one is a client bug we want to see as a 400, not a row that
 * silently fails to deliver forever.
 */

const registerSchema = z.object({
  token: z.string().regex(EXPO_PUSH_TOKEN_RE),
  platform: z.enum(["ios", "android", "web"]),
  // Diagnostics only, and bounded so a broken client cannot write essays
  // into the column.
  appVersion: z.string().min(1).max(40).optional(),
});

const unregisterSchema = z.object({
  token: z.string().regex(EXPO_PUSH_TOKEN_RE),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  const result = await registerStaffDevice(gate.staff.userId, parsed.data);
  if (!result.ok) {
    // `token_taken` is a handset registered under another tenant — a
    // 409, not a 400: the body was fine, the world disagrees.
    const status = result.error === "token_taken" ? 409 : 403;
    return withCors(NextResponse.json({ ok: false, error: result.error }, { status }));
  }
  return withCors(NextResponse.json({ ok: true }, { headers: STAFF_NO_STORE }));
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const parsed = unregisterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  await unregisterStaffDevice(gate.staff.userId, parsed.data.token);
  return withCors(NextResponse.json({ ok: true }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
