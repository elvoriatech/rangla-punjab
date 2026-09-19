import { NextResponse, type NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { corsPreflight, withCors } from "@/lib/cors";
import { readIssuePhoto } from "@/lib/issue-service";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { staffFromRequest } from "@/lib/staff-auth";
import { resolveActiveTenantId } from "@/lib/tenant";

/**
 * The ONLY way a complaint photo's bytes leave the server.
 *
 * These images are a guest's own camera roll — a cold curry, sometimes a
 * kitchen, sometimes a living room — so they deliberately do NOT go
 * through `/img`, which is public, key-addressable and immutable-cached.
 * The storage key never reaches a client at all; a caller asks for a
 * MESSAGE and has to prove it may read that message's order.
 *
 * Three credentials open it, one per surface that legitimately renders a
 * thread:
 *
 *   1. `?token=` — the guest's receipt token, and its claim must name
 *      THIS order. It rides the query string because an `<img src>` on
 *      the zero-JS tracking page cannot send a header.
 *   2. `X-Staff-Token` — the restaurant's app, which sets image headers.
 *   3. the dashboard session cookie — the owner reading the thread in a
 *      browser.
 *
 * Everything that is not one of those three, and every mismatch between
 * the message and the order in the path, is one flat `404`: a probe must
 * not be able to tell "wrong credential" from "no such photo".
 */

const PHOTO_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  // The bytes are re-encoded by `normalizeImage`, so the Content-Type is
  // ours and true — but a browser must still never sniff past it.
  "X-Content-Type-Options": "nosniff",
} as const;

function notFound(): NextResponse {
  return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
}

/** Which tenant may this caller read, if any? Tried cheapest first. */
async function resolveTenant(req: NextRequest, orderId: string): Promise<string | null> {
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    const claim = verifyReceiptToken(token);
    return claim && claim.orderId === orderId ? claim.tenantId : null;
  }

  if (req.headers.get("x-staff-token")) {
    // Re-checks the owner membership per request, so revoking access
    // shuts this door on the very next image load.
    const staff = await staffFromRequest(req);
    return staff ? staff.tenantId : null;
  }

  // `cookies()` throws outside a request scope (a direct call from a test,
  // a future background caller). No cookie is the same answer as no
  // credential, so it collapses to null rather than a 500.
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;
  // Membership IS the check: `resolve_active_tenant` answers nothing for
  // a user who holds none, which is the same gate every dashboard read
  // passes through.
  return resolveActiveTenantId(userId);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string; messageId: string }> },
): Promise<NextResponse> {
  const { orderId, messageId } = await ctx.params;

  const tenantId = await resolveTenant(req, orderId);
  if (!tenantId) return notFound();

  const photo = await readIssuePhoto(tenantId, messageId);
  // The message must belong to the order in the path: without this, one
  // valid receipt token would open every photo in the tenant.
  if (!photo || photo.orderId !== orderId) return notFound();

  return withCors(
    new NextResponse(new Uint8Array(photo.bytes), {
      status: 200,
      headers: { ...PHOTO_HEADERS, "Content-Type": photo.contentType },
    }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
