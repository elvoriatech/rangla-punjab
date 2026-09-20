import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { redeemGiftCardAtCounter, type RedeemError } from "@/lib/gift-card-service";
import { STAFF_NO_STORE, requireStaff } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/gift-cards/redeem — take a gift card at the counter.
 *
 * Single use, full value, irreversible from the app: the card goes to
 * `redeemed` and the staff user who took it is recorded, because "who
 * took it" is the question the owner asks when the till does not add up.
 *
 * Every refusal is NAMED rather than collapsed into "invalid". A cashier
 * holding a phone in front of a guest needs to say WHICH thing is wrong
 * — expired, already used, not paid for — and a generic error turns a
 * ten-second conversation into an argument.
 */

const bodySchema = z.object({
  /** As typed or scanned; normalised server-side. */
  code: z.string().min(4).max(200),
  /** Optional note the owner may want on the record ("table 7"). */
  note: z.string().trim().max(200).optional(),
});

/**
 * 404 for a code we have never issued; 409 for a real card that cannot
 * be spent right now. The split matters to the UI: the first is "check
 * what you typed", the second is "the card is real, here is its story".
 */
function statusFor(error: RedeemError): number {
  return error === "unknown" ? 404 : 409;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ ok: false, error: "invalid" }, { status: 400, headers: STAFF_NO_STORE }),
    );
  }

  const result = await redeemGiftCardAtCounter(
    gate.staff.tenantId,
    parsed.data.code,
    gate.staff.userId,
    parsed.data.note,
  );

  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: statusFor(result.error), headers: STAFF_NO_STORE },
      ),
    );
  }

  return withCors(NextResponse.json({ ok: true, card: result.card }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
