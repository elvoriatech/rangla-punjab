import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { prisma } from "@/lib/db";
import { deletePrefix } from "@/lib/image-storage";
import { MAX_BYTES } from "@/lib/media-service";
import { publishDraft } from "@/lib/menu-versions-service";
import { signSession } from "@/lib/session";
import type { StaffItem } from "@/lib/staff-menu-service";
import { asTenant } from "@/lib/tenant";
import { DELETE, POST } from "./route";

/**
 * The dish photo, uploaded from the phone that took it.
 *
 * Two things are under test. First the PIPELINE: the bytes must go through
 * the dashboard's own `saveUploadedImage` — a real `Media` row under the
 * tenant prefix, normalized and EXIF-stripped — so a photo added from the
 * app is indistinguishable from one added on the web. Second the PAIR: like
 * every other staff write, the photo lands on the published row AND its
 * draft twin, so guests see it now and the next publish does not undo it.
 *
 * The uploads here are real PNG bytes, because `normalizeImage` genuinely
 * decodes them — a fixture of zeroes would only ever prove the 400 path.
 */

/** One transparent pixel — real PNG bytes, so sharp genuinely decodes it. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface PhotoBody {
  ok: boolean;
  error?: string;
  item?: StaffItem;
  mirrored?: boolean;
}

describe("/api/v1/staff/items/{id}/photo", () => {
  let tenantId: string;
  let userId: string;
  let staffToken: string;
  let draftDalId: string;
  let publishedDalId: string;

  /** A second restaurant entirely — its dish id must read as "no such dish". */
  let otherTenantId: string;
  let otherUserId: string;
  let otherItemId: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  /** Venue → menu → draft → category → one dish, for either tenant. */
  async function seedVenue(tid: string, slug: string): Promise<{ itemId: string }> {
    return asTenant(tid, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId: tid, name: "Photo Venue", slug, currency: "EUR" },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId: tid, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const draft = await tx.menuVersion.create({
        data: { tenantId: tid, menuId: menu.id, status: "draft" },
        select: { id: true },
      });
      const category = await tx.category.create({
        data: { tenantId: tid, menuVersionId: draft.id, name: "Mains", orderIndex: 100 },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: {
          tenantId: tid,
          categoryId: category.id,
          name: "Dal Makhani",
          priceCents: 1200,
          orderIndex: 100,
        },
        select: { id: true },
      });
      return { itemId: item.id };
    });
  }

  beforeAll(async () => {
    const signup = await signupUser({
      email: `photo-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Photo Test",
    });
    if (!signup.ok) throw new Error("signup failed");
    tenantId = signup.tenantId;
    userId = signup.userId;
    staffToken = signSession(userId);

    const slug = `photo-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    draftDalId = (await seedVenue(tenantId, slug)).itemId;

    const published = await publishDraft(userId);
    if (!published.ok) throw new Error(`publish failed: ${published.error}`);
    publishedDalId = await asTenant(tenantId, async (tx) => {
      const twin = await tx.item.findFirstOrThrow({
        where: { sourceItemId: draftDalId },
        select: { id: true },
      });
      return twin.id;
    });

    const other = await signupUser({
      email: `photo-other-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Other Restaurant",
    });
    if (!other.ok) throw new Error("second signup failed");
    otherTenantId = other.tenantId;
    otherUserId = other.userId;
    otherItemId = (await seedVenue(otherTenantId, `photo-other-${randomUUID().slice(0, 8)}`))
      .itemId;
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    for (const tid of [tenantId, otherTenantId]) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
      // These uploads are real files on disk; the DB teardown can't see them.
      await deletePrefix(tid);
    }
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  /** A genuine multipart POST — the boundary is left to the runtime. */
  function postPhoto(id: string, blob: Blob | null, token = staffToken): NextRequest {
    const form = new FormData();
    if (blob) form.append("photo", blob, "dish.png");
    return new NextRequest(`http://localhost:3000/api/v1/staff/items/${id}/photo`, {
      method: "POST",
      headers: {
        ...(token ? { "x-staff-token": token } : {}),
        "x-forwarded-for": ip,
      },
      body: form,
    });
  }

  function upload(
    id: string,
    blob: Blob | null,
    token = staffToken,
  ): Promise<{ status: number; body: PhotoBody }> {
    return POST(postPhoto(id, blob, token), { params: Promise.resolve({ id }) }).then(
      async (res) => ({ status: res.status, body: (await res.json()) as PhotoBody }),
    );
  }

  function remove(id: string, token = staffToken): Promise<{ status: number; body: PhotoBody }> {
    const req = new NextRequest(`http://localhost:3000/api/v1/staff/items/${id}/photo`, {
      method: "DELETE",
      headers: { ...(token ? { "x-staff-token": token } : {}), "x-forwarded-for": ip },
    });
    return DELETE(req, { params: Promise.resolve({ id }) }).then(async (res) => ({
      status: res.status,
      body: (await res.json()) as PhotoBody,
    }));
  }

  const png = (bytes: Buffer = ONE_PIXEL_PNG): Blob =>
    new Blob([new Uint8Array(bytes)], { type: "image/png" });

  /** What the pair actually points at, straight from the rows. */
  async function photoIds(...ids: string[]): Promise<(string | null)[]> {
    const rows = await asTenant(tenantId, (tx) =>
      tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, photoMediaId: true } }),
    );
    return ids.map((id) => rows.find((r) => r.id === id)?.photoMediaId ?? null);
  }

  it("401s without a staff token, and with a guest-shaped one", async () => {
    for (const token of ["", randomUUID().replace(/-/g, "")]) {
      const res = await upload(publishedDalId, png(), token);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: "unauthorized" });

      const del = await remove(publishedDalId, token);
      expect(del.status).toBe(401);
      expect(del.body).toEqual({ ok: false, error: "unauthorized" });
    }
    // And nothing was attached on the way to the refusal.
    expect(await photoIds(publishedDalId, draftDalId)).toEqual([null, null]);
  });

  it("stores a real PNG and attaches it to the published row AND its draft twin", async () => {
    const { status, body } = await upload(publishedDalId, png());
    expect(status).toBe(200);
    expect(body.mirrored).toBe(true);
    expect(body.item?.id).toBe(publishedDalId);

    // Absolute, and served through the resizing /img proxy — not the
    // placeholder a dish without a photo falls back to.
    const photoUrl = body.item!.photoUrl;
    expect(photoUrl.startsWith("http")).toBe(true);
    expect(photoUrl).toContain("/img/");

    const [publishedMediaId, draftMediaId] = await photoIds(publishedDalId, draftDalId);
    expect(publishedMediaId).not.toBeNull();
    expect(draftMediaId).toBe(publishedMediaId);

    // The Media row is the dashboard's own: under the tenant prefix, with
    // the dish name as alt text, and the normalized (not the raw) size.
    const media = await asTenant(tenantId, (tx) =>
      tx.media.findFirstOrThrow({
        where: { id: publishedMediaId! },
        select: { storageKey: true, altText: true, width: true, height: true, bytes: true },
      }),
    );
    expect(media.storageKey.startsWith(`${tenantId}/uploads/`)).toBe(true);
    expect(media.altText).toBe("Dal Makhani");
    expect(media).toMatchObject({ width: 1, height: 1 });
    expect(media.bytes).toBeGreaterThan(0);
    expect(photoUrl).toContain(encodeURIComponent(media.storageKey));
  });

  it("replaces the photo with a second upload, on both rows", async () => {
    const [before] = await photoIds(publishedDalId);
    const { status, body } = await upload(draftDalId, png());
    expect(status).toBe(200);
    expect(body.mirrored).toBe(true);

    const [publishedMediaId, draftMediaId] = await photoIds(publishedDalId, draftDalId);
    expect(publishedMediaId).not.toBe(before);
    expect(draftMediaId).toBe(publishedMediaId);
  });

  it("refuses bytes that are not an image, and keeps the photo it had", async () => {
    const [before] = await photoIds(publishedDalId);
    const garbage = new Blob([new Uint8Array(Buffer.from("this is not a PNG at all"))], {
      type: "image/png",
    });

    const { status, body } = await upload(publishedDalId, garbage);
    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "invalid_photo" });
    expect((await photoIds(publishedDalId))[0]).toBe(before);
  });

  it("refuses a missing file, a non-multipart body, and a disallowed type", async () => {
    const noFile = await upload(publishedDalId, null);
    expect(noFile.status).toBe(400);
    expect(noFile.body).toEqual({ ok: false, error: "invalid_photo" });

    const pdf = await upload(
      publishedDalId,
      new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: "application/pdf" }),
    );
    expect(pdf.status).toBe(400);
    expect(pdf.body).toEqual({ ok: false, error: "invalid_photo" });

    const json = new NextRequest(
      `http://localhost:3000/api/v1/staff/items/${publishedDalId}/photo`,
      {
        method: "POST",
        headers: {
          "x-staff-token": staffToken,
          "x-forwarded-for": ip,
          "content-type": "application/json",
        },
        body: JSON.stringify({ photo: "hello" }),
      },
    );
    const res = await POST(json, { params: Promise.resolve({ id: publishedDalId }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_photo" });
  });

  it("refuses an upload over the 10 MB intake with 413", async () => {
    const oversize = new Blob([new Uint8Array(MAX_BYTES + 1)], { type: "image/png" });
    const { status, body } = await upload(publishedDalId, oversize);
    expect(status).toBe(413);
    expect(body).toEqual({ ok: false, error: "too_large" });
  });

  it("404s another restaurant's dish without storing anything", async () => {
    const mediaBefore = await asTenant(otherTenantId, (tx) => tx.media.count());

    const { status, body } = await upload(otherItemId, png());
    expect(status).toBe(404);
    expect(body).toEqual({ ok: false, error: "not_found" });

    const unknown = await upload("no-such-item", png());
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ ok: false, error: "not_found" });

    // The 404 came BEFORE the bytes were stored — no orphan Media row, on
    // either side of the tenant boundary.
    expect(await asTenant(otherTenantId, (tx) => tx.media.count())).toBe(mediaBefore);
    expect(
      await asTenant(otherTenantId, (tx) =>
        tx.item.findFirstOrThrow({
          where: { id: otherItemId },
          select: { photoMediaId: true },
        }),
      ),
    ).toEqual({ photoMediaId: null });

    const del = await remove(otherItemId);
    expect(del.status).toBe(404);
    expect(del.body).toEqual({ ok: false, error: "not_found" });
  });

  it("detaches the photo from both rows on DELETE, keeping the upload itself", async () => {
    const [attached] = await photoIds(publishedDalId);
    expect(attached).not.toBeNull();

    const { status, body } = await remove(publishedDalId);
    expect(status).toBe(200);
    expect(body.mirrored).toBe(true);
    expect(await photoIds(publishedDalId, draftDalId)).toEqual([null, null]);

    // No upload is pointing at the dish any more, so the answer carries the
    // same stable placeholder a never-photographed dish gets.
    expect(body.item!.photoUrl).not.toContain("/img/");
    expect(body.item!.photoUrl.startsWith("http")).toBe(true);

    // The Media row survives the detach — exactly as the dashboard's own
    // remove-photo action leaves it.
    expect(await asTenant(tenantId, (tx) => tx.media.count({ where: { id: attached! } }))).toBe(1);

    // Removing a photo that is already gone is a no-op, not an error.
    const again = await remove(draftDalId);
    expect(again.status).toBe(200);
    expect(again.body.item?.id).toBe(draftDalId);
  });
});
