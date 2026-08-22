import QRCode from "qrcode";

/**
 * Server-side QR generator for the public menu URL. Both PNG and SVG
 * outputs are supported; the caller picks the format that fits the medium
 * (PNG for tent-card printing, SVG for laser-etched or vector-heavy
 * designs). Error correction is set to `H` (30% redundancy) so a
 * centre-logo overlay does not push the code below the readable threshold.
 *
 * PNG logo overlay is deferred until we ship an image compositor (P1-15
 * `imgproxy` will cover this). SVG logo overlay is supported today via a
 * post-render `<image>` injection — no extra deps.
 */

const HIGH = "H" as const;
// Slightly larger than the qrcode default (4) so a printed card doesn't
// pixelate under a phone's macro lens. A 25×25 module code at 8 px/module
// gives a 200-px raster, which is crisp at 300 DPI print.
const SCALE = 8;
const MARGIN = 2;

export interface RenderQrOptions {
  /** Data-URL (e.g. `data:image/png;base64,…`) or absolute HTTPS URL of a
   *  logo to composite over the QR's centre. Used by both the SVG path
   *  (`<image>` injection) and the PNG path (sharp compositing). */
  logoDataUrl?: string;
  /** Optional foreground colour (defaults to black). Set to match the
   *  venue's primary colour for branded prints. Contrast against `light`
   *  must clear 3:1 or the QR fails to scan. */
  dark?: string;
  /** Background colour (defaults to white). */
  light?: string;
}

export async function renderQrPng(url: string, options: RenderQrOptions = {}): Promise<Buffer> {
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: HIGH,
    scale: SCALE,
    margin: MARGIN,
    color: {
      dark: options.dark ?? "#000000",
      light: options.light ?? "#ffffff",
    },
  });
  if (!options.logoDataUrl) return qr;
  return compositeLogoPng(qr, options.logoDataUrl, options.light ?? "#ffffff");
}

/**
 * Centre-composite a logo onto a rendered QR PNG. Mirrors injectLogo's
 * geometry: logo at 20 % of the code's width over a 24 % padding square
 * (within `H`-level error correction's 30 % redundancy). Only data-URLs
 * are accepted here — remote fetches don't belong in the render path.
 */
async function compositeLogoPng(qr: Buffer, logoDataUrl: string, pad: string): Promise<Buffer> {
  const match = logoDataUrl.match(/^data:image\/[a-z+.-]+;base64,(.+)$/i);
  if (!match) return qr;
  const { default: sharp } = await import("sharp");
  const base = sharp(qr);
  const { width } = await base.metadata();
  if (!width) return qr;

  const logoSize = Math.round(width * 0.2);
  const padSize = Math.round(width * 0.24);
  const logo = await sharp(Buffer.from(match[1]!, "base64"))
    .resize(logoSize, logoSize, { fit: "inside" })
    .png()
    .toBuffer();
  const padSquare = await sharp({
    create: { width: padSize, height: padSize, channels: 4, background: pad },
  })
    .png()
    .toBuffer();

  return base
    .composite([
      { input: padSquare, gravity: "centre" },
      { input: logo, gravity: "centre" },
    ])
    .png()
    .toBuffer();
}

export async function renderQrSvg(url: string, options: RenderQrOptions = {}): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: HIGH,
    margin: MARGIN,
    color: {
      dark: options.dark ?? "#000000",
      light: options.light ?? "#ffffff",
    },
  });
  if (!options.logoDataUrl) return svg;
  return injectLogo(svg, options.logoDataUrl);
}

/**
 * Inject a centre logo into an already-rendered QR SVG. Parses the
 * `viewBox` to derive the code's own coordinate space, positions the
 * logo at 20 % width / 20 % height (fits within `H`-level error
 * correction's headroom), and adds a small white padding rect underneath
 * so the logo stays legible on darker QR modules.
 */
function injectLogo(svg: string, logoUrl: string): string {
  const viewBox = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!viewBox) return svg;
  const size = parseFloat(viewBox[1]!);
  const logoSize = size * 0.2;
  const pad = size * 0.24;
  const logoX = (size - logoSize) / 2;
  const logoY = (size - logoSize) / 2;
  const padX = (size - pad) / 2;
  const padY = (size - pad) / 2;
  const overlay =
    `<rect x="${padX}" y="${padY}" width="${pad}" height="${pad}" fill="#ffffff"/>` +
    `<image href="${escapeXmlAttr(logoUrl)}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`;
  // Insert before the closing tag so the overlay layers above every module.
  return svg.replace(/<\/svg>\s*$/i, `${overlay}</svg>`);
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
