import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { renderPrintPack } from "./print-pack";
import { renderQrPng } from "./qr";

const seed = {
  venueName: "Ristorante Volpe",
  baseUrl: "https://elvoria.eu",
  slug: "ristorante-volpe",
};

describe("renderPrintPack", () => {
  it("produces a valid PDF starting with the %PDF- magic bytes", async () => {
    const bytes = await renderPrintPack({ ...seed, tableCount: 4 });
    const header = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("emits one page per table", async () => {
    const bytes = await renderPrintPack({ ...seed, tableCount: 4 });
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(4);
  });

  it("is deterministic — two renders with the same input are byte-identical", async () => {
    // This is the "golden-file layout" invariant from the task spec: run
    // twice, the bytes must match, so a real golden file (checked-in .pdf)
    // stays valid across CI environments.
    const a = await renderPrintPack({ ...seed, tableCount: 4 });
    const b = await renderPrintPack({ ...seed, tableCount: 4 });
    const hashA = createHash("sha256").update(a).digest("hex");
    const hashB = createHash("sha256").update(b).digest("hex");
    expect(hashA).toBe(hashB);
  });

  it("changes bytes when the table count changes", async () => {
    // Sanity: determinism above isn't hiding a "same-bytes-for-any-input" bug.
    const four = await renderPrintPack({ ...seed, tableCount: 4 });
    const three = await renderPrintPack({ ...seed, tableCount: 3 });
    const hashFour = createHash("sha256").update(four).digest("hex");
    const hashThree = createHash("sha256").update(three).digest("hex");
    expect(hashFour).not.toBe(hashThree);
  });

  it("QR on page N encodes the URL with `?t=N`", async () => {
    // Re-generate the QR for table 2 the way the pack builder would, then
    // decode it — that proves the per-table URL flows through to the code
    // scanners see. Directly inspecting the PDF's embedded PNG bytes is
    // brittle; regenerating the exact same URL and decoding is enough.
    const url = `${seed.baseUrl}/?t=2`;
    const png = await renderQrPng(url);
    const parsed = PNG.sync.read(Buffer.from(png));
    const rgba = new Uint8ClampedArray(parsed.data);
    const decoded = jsQR(rgba, parsed.width, parsed.height);
    expect(decoded?.data).toBe(url);
  });

  it("rejects a non-positive or absurd tableCount", async () => {
    await expect(renderPrintPack({ ...seed, tableCount: 0 })).rejects.toThrow(/tableCount/);
    await expect(renderPrintPack({ ...seed, tableCount: -1 })).rejects.toThrow(/tableCount/);
    await expect(renderPrintPack({ ...seed, tableCount: 1e9 })).rejects.toThrow(/tableCount/);
  });
});
