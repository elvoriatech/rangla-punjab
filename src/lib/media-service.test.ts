import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { parseImageDimensions } from "./media-service";

/** Minimal valid JPEG header up to an SOF0 marker for a 320×240 image. */
function jpegWithSof(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  // APP0 segment (JFIF), 16 bytes long.
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]);
  // SOF0: marker, length 17, precision 8, height(2), width(2), 3 components.
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([soi, app0, sof]);
}

describe("parseImageDimensions", () => {
  it("reads PNG IHDR dimensions", () => {
    const png = new PNG({ width: 12, height: 34 });
    const buf = PNG.sync.write(png);
    expect(parseImageDimensions(buf, "image/png")).toEqual({ width: 12, height: 34 });
  });

  it("reads JPEG SOF dimensions", () => {
    expect(parseImageDimensions(jpegWithSof(320, 240), "image/jpeg")).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("reads WebP VP8X extended-header dimensions", () => {
    const buf = Buffer.alloc(30);
    buf.write("RIFF", 0, "ascii");
    buf.write("WEBP", 8, "ascii");
    buf.write("VP8X", 12, "ascii");
    // width-1 = 639, height-1 = 479, 24-bit LE.
    buf.writeUIntLE(639, 24, 3);
    buf.writeUIntLE(479, 27, 3);
    expect(parseImageDimensions(buf, "image/webp")).toEqual({ width: 640, height: 480 });
  });

  it("returns 0×0 for garbage without throwing", () => {
    expect(parseImageDimensions(Buffer.from("not an image at all"), "image/png")).toEqual({
      width: 0,
      height: 0,
    });
    expect(parseImageDimensions(Buffer.alloc(2), "image/jpeg")).toEqual({ width: 0, height: 0 });
    expect(parseImageDimensions(Buffer.alloc(0), "image/webp")).toEqual({ width: 0, height: 0 });
  });
});
