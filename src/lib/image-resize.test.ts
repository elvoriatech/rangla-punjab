import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  ALLOWED_WIDTHS,
  imgRequestSchema,
  isAllowedWidth,
  MAX_WIDTH,
  resizeImage,
} from "./image-resize";
import { BANNER_WIDTHS } from "./menu-images";

/** Solid-colour source photo. */
async function testImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

describe("width whitelist", () => {
  it("accepts every width the app renders", () => {
    for (const w of ALLOWED_WIDTHS) {
      expect(isAllowedWidth(w)).toBe(true);
      const parsed = imgRequestSchema.safeParse({ w: String(w) });
      expect(parsed.success, `width ${w} should parse`).toBe(true);
    }
  });

  it("rejects widths outside the set — no unbounded encode, no unbounded cache", () => {
    for (const w of [1, 2, 63, 100, 481, 1000, 1921, 4096, 100000]) {
      expect(isAllowedWidth(w)).toBe(false);
      expect(imgRequestSchema.safeParse({ w: String(w) }).success, `width ${w}`).toBe(false);
    }
  });

  it("rejects junk, negatives, and fractions", () => {
    for (const w of ["0", "-480", "480.5", "abc", "", "480px"]) {
      expect(imgRequestSchema.safeParse({ w }).success, `width ${w}`).toBe(false);
    }
  });

  it("caps MAX_WIDTH at the largest allowed variant", () => {
    expect(MAX_WIDTH).toBe(1920);
    expect(Math.max(...ALLOWED_WIDTHS)).toBe(MAX_WIDTH);
  });

  it("covers the doubled widths menuImageSrcSet emits for 2x screens", () => {
    // The dish cards render at 320/480/640 and ask for 2x of each.
    for (const base of [320, 480, 640]) {
      expect(isAllowedWidth(base), `${base} 1x`).toBe(true);
      expect(isAllowedWidth(base * 2), `${base} 2x`).toBe(true);
    }
  });

  it("covers every banner width", () => {
    for (const w of BANNER_WIDTHS) expect(isAllowedWidth(w)).toBe(true);
  });

  it("covers the widths /api/v1/menu hands the mobile app", () => {
    // Logo 192, category photo 160, item photo 640 — the mobile client
    // consumes these absolute URLs verbatim, so a miss here 400s the app.
    for (const w of [160, 192, 640]) expect(isAllowedWidth(w)).toBe(true);
  });

  it("defaults the format to webp", () => {
    const parsed = imgRequestSchema.safeParse({ w: "480" });
    if (!parsed.success) throw new Error("expected ok");
    expect(parsed.data.fmt).toBe("webp");
  });

  it("rejects an unknown format", () => {
    expect(imgRequestSchema.safeParse({ w: "480", fmt: "gif" }).success).toBe(false);
  });
});

describe("resizeImage", () => {
  it("resizes down to the requested width", async () => {
    const out = await resizeImage(await testImage(1600, 1200), 480, "webp");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(360);
  });

  it("never upscales a small original", async () => {
    const out = await resizeImage(await testImage(200, 200), 640, "webp");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
  });

  it("encodes each supported format", async () => {
    const src = await testImage(800, 600);
    // AVIF is a HEIF container, which is how sharp reports it back.
    const reportedAs = { webp: "webp", avif: "heif", jpeg: "jpeg", png: "png" } as const;
    for (const fmt of ["webp", "avif", "jpeg", "png"] as const) {
      const meta = await sharp(await resizeImage(src, 320, fmt)).metadata();
      expect(meta.format, `format ${fmt}`).toBe(reportedAs[fmt]);
      expect(meta.width).toBe(320);
    }
  });

  it("produces deterministic bytes — the cache can keep one copy forever", async () => {
    const src = await testImage(800, 600);
    const a = await resizeImage(src, 480, "webp");
    const b = await resizeImage(src, 480, "webp");
    expect(a.equals(b)).toBe(true);
  });

  it("rejects an undecodable source", async () => {
    await expect(resizeImage(Buffer.from("not-an-image"), 480, "webp")).rejects.toThrow();
  });
});

describe("square crop", () => {
  it("accepts crop=sq and nothing else", () => {
    expect(imgRequestSchema.parse({ w: "160", crop: "sq" }).crop).toBe("sq");
    expect(imgRequestSchema.parse({ w: "160" }).crop).toBeUndefined();
    expect(imgRequestSchema.safeParse({ w: "160", crop: "wide" }).success).toBe(false);
  });

  it("renders a landscape photo as a centred w×w square", async () => {
    const out = await resizeImage(await testImage(960, 720), 320, "webp", "sq");
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([320, 320]);
  });

  it("renders a portrait photo as a square too", async () => {
    const out = await resizeImage(await testImage(600, 900), 160, "avif", "sq");
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([160, 160]);
  });

  it("is far smaller than the 960 render the dish card used to fetch at 2x", async () => {
    const src = await sharp({
      create: {
        width: 960,
        height: 720,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: "gaussian", mean: 128, sigma: 40 },
      },
    })
      .jpeg()
      .toBuffer();
    const before = await resizeImage(src, 960, "webp");
    const after = await resizeImage(src, 320, "webp", "sq");
    expect(after.length).toBeLessThan(before.length / 3);
  });
});
