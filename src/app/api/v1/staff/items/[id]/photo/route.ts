import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { ALLOWED_IMAGE_TYPES, MAX_BYTES, saveUploadedImage } from "@/lib/media-service";
import { findStaffItemName, setStaffItemPhoto } from "@/lib/staff-menu-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/items/{id}/photo — multipart, file field `photo`.
 * DELETE /api/v1/staff/items/{id}/photo — take the photo back off.
 *
 * The one dish edit the app could not do (`PATCH` covers price, name,
 * availability and offers): replacing the picture. A phone is where the
 * photo IS — the owner plates the dish, shoots it, and the guest menu has
 * it before the next table orders.
 *
 * Bytes ride the SAME pipeline the dashboard's item form uses
 * (`saveUploadedImage`): the declared `Content-Type` is only a cheap first
 * gate, and `normalizeImage` is the real check — it detects the format from
 * the bytes, strips EXIF/GPS, caps the longest edge at 2048px and re-encodes,
 * so a renamed non-image never reaches storage. The `Media` row it creates is
 * then attached to the published row AND its draft twin, exactly as a price
 * change is, and the public menu is purged.
 *
 * Refusals: 400 `invalid_photo` (not multipart, no file, wrong declared type,
 * bytes sharp cannot decode), 413 `too_large` (> 10 MB raw), 404 `not_found`
 * (no such dish in this tenant — another tenant's id reads the same way).
 */

function fail(error: string, status: number): NextResponse {
  return withCors(NextResponse.json({ ok: false, error }, { status }));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;

  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return fail("invalid_photo", 400);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("invalid_photo", 400);
  }

  const photo = form.get("photo");
  if (photo === null || typeof photo === "string" || photo.size === 0) {
    return fail("invalid_photo", 400);
  }
  // The declared size, checked BEFORE the file is copied into a Buffer and
  // handed to sharp — a 50 MB upload is refused without ever being decoded.
  if (photo.size > MAX_BYTES) return fail("too_large", 413);
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(photo.type)) {
    return fail("invalid_photo", 400);
  }

  // The dish first: a 404 must not leave an orphan Media row (and a file on
  // disk) behind it. The name is the alt text, as on the dashboard's form.
  const name = await findStaffItemName(gate.staff.tenantId, id);
  if (name === null) return fail("not_found", 404);

  const saved = await saveUploadedImage(gate.staff.userId, photo, name);
  if (!saved.ok) {
    return saved.error === "too_large" ? fail("too_large", 413) : fail("invalid_photo", 400);
  }

  const result = await setStaffItemPhoto(gate.staff.tenantId, id, saved.mediaId);
  if (!result.ok) return fail(result.error === "not_found" ? "not_found" : "invalid_photo", 404);

  return withCors(
    NextResponse.json(
      { ok: true, item: result.value.item, mirrored: result.value.mirrored },
      { headers: STAFF_NO_STORE },
    ),
  );
}

/**
 * Detach the photo. The `Media` row and its file stay — an older published
 * version may still show it, and a mis-tap should not destroy an upload.
 * The dish falls back to the same stable placeholder a never-photographed
 * dish gets, so `item.photoUrl` is still a URL the app can render.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const result = await setStaffItemPhoto(gate.staff.tenantId, id, null);
  if (!result.ok) return fail("not_found", 404);

  return withCors(
    NextResponse.json(
      { ok: true, item: result.value.item, mirrored: result.value.mirrored },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
