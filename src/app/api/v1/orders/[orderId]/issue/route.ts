import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  getGuestIssueState,
  postGuestIssueMessage,
  withPhotoUrls,
  type GuestPostError,
  MAX_ISSUE_PHOTO_BYTES,
} from "@/lib/issue-service";
import { checkRateLimit, ISSUE_IP } from "@/lib/rate-limit";
import { verifyReceiptToken } from "@/lib/receipt-token";

/**
 * The guest half of a complaint thread (P7-10).
 *
 * Authorized by the receipt token exactly like `/status` — possession of
 * it IS the permission to talk about that one order, and the claim's
 * `orderId` must match the path so a token for order A can never open a
 * thread on order B.
 *
 * The POST accepts multipart OR JSON on the same URL, because the two
 * clients genuinely differ: the zero-JS tracking page posts a real
 * `<form enctype="multipart/form-data">` (that is how a photo reaches a
 * server without JavaScript), while the app sends JSON when there is no
 * photo to carry. One endpoint, one status machine, two envelopes.
 *
 * Never cached: a thread is a conversation.
 */

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/** The refusals, mapped once. `window_closed` is a 403 rather than a 404
 *  because the order is real and the guest may still call the
 *  restaurant; `resolved` is a 409 because the thread exists and its
 *  state is what refused. */
const STATUS_BY_ERROR: Record<GuestPostError, number> = {
  invalid: 400,
  invalid_photo: 400,
  too_large: 413,
  not_found: 404,
  window_closed: 403,
  resolved: 409,
};

function fail(error: string, status: number): NextResponse {
  return withCors(NextResponse.json({ ok: false, error }, { status }));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const claim = verifyReceiptToken(token);
  if (!claim || claim.orderId !== orderId) return fail("invalid_token", 401);

  const state = await getGuestIssueState(claim.tenantId, orderId);
  if (!state) return fail("not_found", 404);

  return withCors(
    NextResponse.json(
      {
        ok: true,
        canReport: state.canReport,
        windowEndsAt: state.windowEndsAt,
        // The caller's own token is echoed into every photo URL — we never
        // mint one, so a link copied out of this answer carries exactly
        // the permission the caller already had.
        issue: state.issue ? withPhotoUrls(state.issue, token) : null,
      },
      { headers: NO_STORE },
    ),
  );
}

interface PostInput {
  token: string;
  body: string;
  photo: { bytes: Buffer; contentType: string } | null;
}

/**
 * Read the two shapes into one. A multipart part that is not a file, a
 * body that is not a string, or a payload the runtime cannot parse at all
 * collapses to `null` → 400 `invalid`, so a malformed upload never reads
 * as an empty complaint.
 */
async function readInput(req: NextRequest): Promise<PostInput | "too_large" | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return null;
    }
    const token = form.get("token");
    const body = form.get("body");
    if (typeof token !== "string" || typeof body !== "string") return null;

    const file = form.get("photo");
    if (file === null || typeof file === "string" || file.size === 0) {
      return { token, body, photo: null };
    }
    // Checked on the declared size BEFORE the bytes are pulled into
    // memory — a 50 MB upload is refused without ever being buffered.
    if (file.size > MAX_ISSUE_PHOTO_BYTES) return "too_large";
    return {
      token,
      body,
      photo: { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type },
    };
  }

  const json = (await req.json().catch(() => null)) as {
    token?: unknown;
    body?: unknown;
  } | null;
  if (!json || typeof json.token !== "string" || typeof json.body !== "string") return null;
  return { token: json.token, body: json.body, photo: null };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await ctx.params;

  // First statement on the path: the token authorizes the write, so
  // per-IP is the only handle on someone spraying posts at guessed ids.
  const rl = await checkRateLimit(ISSUE_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  const input = await readInput(req);
  if (input === "too_large") return fail("too_large", 413);
  if (!input) return fail("invalid", 400);

  const claim = verifyReceiptToken(input.token);
  if (!claim || claim.orderId !== orderId) return fail("invalid_token", 401);

  const result = await postGuestIssueMessage(claim.tenantId, orderId, {
    body: input.body,
    photo: input.photo,
  });
  if (!result.ok) return fail(result.error, STATUS_BY_ERROR[result.error]);

  return withCors(
    NextResponse.json(
      {
        ok: true,
        created: result.created,
        issue: withPhotoUrls(result.issue, input.token),
      },
      { status: result.created ? 201 : 200, headers: NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
