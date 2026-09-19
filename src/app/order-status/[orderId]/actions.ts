"use server";

import { redirect } from "next/navigation";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { ISSUE_BODY_MAX, MAX_ISSUE_PHOTO_BYTES, postGuestIssueMessage } from "@/lib/issue-service";

/**
 * The guest's "report a problem" post. Authorisation is the receipt token
 * that came with the link — the same credential the tracker itself runs
 * on — so this action never touches a session or a cookie.
 *
 * Progressive enhancement: the form works with JavaScript off, so the
 * outcome cannot be a returned value. Every path ends in a redirect back
 * to the tracker with `?issue=<code>` and the `#issue` anchor; the page
 * turns that code into one line of copy.
 */

/** Back to the tracker, preserving the credential and the language. */
function back(orderId: string, token: string, locale: string, code: string): never {
  const query = new URLSearchParams({ token, issue: code });
  if (locale) query.set("locale", locale);
  redirect(`/order-status/${encodeURIComponent(orderId)}?${query.toString()}#issue`);
}

export async function reportIssueAction(form: FormData): Promise<void> {
  const orderId = String(form.get("orderId") ?? "");
  const token = String(form.get("token") ?? "");
  const locale = String(form.get("locale") ?? "");
  const body = String(form.get("body") ?? "").trim();

  const claim = token ? verifyReceiptToken(token) : null;
  // A bad or mismatched token is the one case with nowhere safe to go
  // back to: the tracker would 404 anyway.
  if (!claim || claim.orderId !== orderId) redirect("/");

  if (!body || body.length > ISSUE_BODY_MAX) back(orderId, token, locale, "invalid");

  // The file part is optional; an empty file input still arrives as a
  // zero-byte File, which is not a photo.
  const file = form.get("photo");
  let photo: { bytes: Buffer; contentType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_ISSUE_PHOTO_BYTES) back(orderId, token, locale, "too_large");
    photo = {
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    };
  }

  const result = await postGuestIssueMessage(claim.tenantId, orderId, { body, photo });
  back(orderId, token, locale, result.ok ? "sent" : result.error);
}
