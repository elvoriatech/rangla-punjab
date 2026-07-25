import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_IMAGE_EDGE_PX, normalizeImage } from "./image-normalize";

/** Solid-colour test image encoded to the given format. */
async function testImage(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp",
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } },
  });
  if (format === "jpeg") return base.jpeg().toBuffer();
  if (format === "webp") return base.webp().toBuffer();
  return base.png().toBuffer();
}

describe("normalizeImage", () => {
  it("downscales oversized photos to the 2048px edge cap, keeping the format", async () => {
    const input = await testImage(4032, 3024, "jpeg");
    const out = await normalizeImage(input);
    if (!out.ok) throw new Error("expected ok");
    expect(out.format).toBe("jpeg");
    expect(out.contentType).toBe("image/jpeg");
    expect(out.width).toBe(MAX_IMAGE_EDGE_PX);
    expect(out.height).toBe(1536); // aspect ratio preserved
  });

  it("never enlarges small images and keeps PNG as PNG", async () => {
    const input = await testImage(300, 200, "png");
    const out = await normalizeImage(input);
    if (!out.ok) throw new Error("expected ok");
    expect(out.format).toBe("png");
    expect(out.width).toBe(300);
    expect(out.height).toBe(200);
  });

  it("detects the real format from bytes — a spoofed MIME cannot pick the encoder", async () => {
    // Caller believes this is PNG; the bytes are WebP. The stored object
    // must be typed by what it actually is.
    const input = await testImage(100, 100, "webp");
    const out = await normalizeImage(input);
    if (!out.ok) throw new Error("expected ok");
    expect(out.contentType).toBe("image/webp");
  });

  it("bakes EXIF orientation into pixels (portrait photos must not come out sideways)", async () => {
    const input = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 }) // 90° CW rotation flag
      .toBuffer();
    const out = await normalizeImage(input);
    if (!out.ok) throw new Error("expected ok");
    expect({ width: out.width, height: out.height }).toEqual({ width: 100, height: 200 });
  });

  it("strips metadata from the stored copy", async () => {
    const input = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .withMetadata({ orientation: 3, density: 300 })
      .toBuffer();
    const out = await normalizeImage(input);
    if (!out.ok) throw new Error("expected ok");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("rejects non-image bytes and unsupported containers", async () => {
    expect(await normalizeImage(Buffer.from("#!/bin/sh\nrm -rf /"))).toEqual({
      ok: false,
      error: "invalid_image",
    });
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]);
    expect(await normalizeImage(gif)).toEqual({ ok: false, error: "invalid_image" });
  });
});
