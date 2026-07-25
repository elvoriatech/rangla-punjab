import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { renderQrPng, renderQrSvg } from "./qr";

function decodePng(buf: Buffer): { text: string | null; width: number; height: number } {
  const png = PNG.sync.read(buf);
  const rgba = new Uint8ClampedArray(png.data);
  const result = jsQR(rgba, png.width, png.height);
  return { text: result?.data ?? null, width: png.width, height: png.height };
}

describe("renderQrPng", () => {
  it("round-trips the URL: decoded QR matches what we encoded", async () => {
    const url = "https://elvoria.eu/r/ristorante-volpe/en";
    const buf = await renderQrPng(url);
    // PNG signature is the first 8 bytes: 89 50 4e 47 0d 0a 1a 0a.
    expect(buf.subarray(0, 4).toString("hex")).toBe("89504e47");
    const { text, width, height } = decodePng(buf);
    expect(text).toBe(url);
    // At scale=8 the raster is comfortably above 100×100 for scannability.
    expect(width).toBeGreaterThan(100);
    expect(height).toBe(width);
  });

  it("survives with a long path (locale + query string still fits at level H)", async () => {
    const url = "https://elvoria.eu/r/ristorante-volpe/de?diet=vegan,gluten_free";
    const { text } = decodePng(await renderQrPng(url));
    expect(text).toBe(url);
  });

  it("respects a custom foreground colour without breaking decode", async () => {
    // Brand green on cream — must still clear the 3:1 contrast QR needs.
    const url = "https://elvoria.eu/r/x";
    const { text } = decodePng(await renderQrPng(url, { dark: "#1f3b2e", light: "#faf7f2" }));
    expect(text).toBe(url);
  });
});

describe("renderQrSvg", () => {
  it("returns a valid `<svg>` document containing a viewBox and rect data", async () => {
    const svg = await renderQrSvg("https://elvoria.eu/r/x");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/);
    // qrcode emits either <rect> modules or <path d="…"> depending on version;
    // one of those must exist.
    expect(svg).toMatch(/<rect|<path/);
  });

  it("injects an <image> overlay when a logoDataUrl is provided", async () => {
    const logo =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    const svg = await renderQrSvg("https://elvoria.eu/r/x", { logoDataUrl: logo });
    expect(svg).toContain('<image href="');
    expect(svg).toContain(logo);
    // Overlay sits before </svg>, i.e. drawn last so it wins z-order.
    const last = svg.lastIndexOf("</svg>");
    expect(svg.indexOf("<image")).toBeLessThan(last);
  });

  it("escapes XML-hostile chars in the logo URL attribute", async () => {
    const svg = await renderQrSvg("https://elvoria.eu/r/x", {
      logoDataUrl: 'https://cdn.example.com/logo.svg?ampersand=&amp;quote="',
    });
    // Neither raw `&` (that isn't part of an entity) nor raw `"` should
    // land inside the attribute value.
    const imageTag = svg.match(/<image href="([^"]*)"/);
    expect(imageTag).not.toBeNull();
    expect(imageTag![1]).not.toContain('"');
    expect(imageTag![1]).toContain("&amp;");
  });

  it("does not add a logo when no logoDataUrl is passed", async () => {
    const svg = await renderQrSvg("https://elvoria.eu/r/x");
    expect(svg).not.toContain("<image");
  });
});
