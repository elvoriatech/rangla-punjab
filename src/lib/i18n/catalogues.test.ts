import { describe, expect, it } from "vitest";
import { UI_LOCALES } from "@/lib/locales";
import { CHECKOUT_COPY, checkoutCopy } from "./checkout";
import { POST_ORDER_COPY, postOrderCopy } from "./post-order";
import {
  GUEST_RESET_COPY,
  NEW_ISSUE_COPY,
  NEW_ORDER_COPY,
  RECEIPT_COPY,
  REWARD_COPY,
  newOrderCopy,
  receiptCopy,
} from "./emails";
import { PDF_COPY, pdfCopy, pdfLocale } from "./pdf";

/**
 * TypeScript already proves every locale has every KEY (each catalogue is
 * `Record<UiLocale, typeof en>`). What it cannot prove is that the values
 * are real copy: an empty string, a stray `TODO`, or a translation that
 * silently kept the English function body all typecheck.
 *
 * So: walk every namespace × every locale and assert each leaf resolves to
 * non-empty text. Function keys are invoked with placeholder arguments —
 * which also catches a parameter the translator forgot to interpolate.
 */

/** Stand-ins for the values a parameterised key interpolates. Distinctive
 *  so the "did the argument survive?" check can look for them. */
const ARGS = ["<A1>", "<A2>", "<A3>"];

function assertCopy(path: string, value: unknown): void {
  if (typeof value === "string") {
    expect(value.trim(), `${path} is empty`).not.toBe("");
    expect(value, `${path} looks like a placeholder`).not.toMatch(/\b(TODO|FIXME)\b|lorem ipsum/);
    return;
  }
  if (typeof value === "function") {
    const fn = value as (...a: unknown[]) => unknown;
    const args = ARGS.slice(0, Math.max(fn.length, 1));
    const out = String(fn(...args));
    expect(typeof fn(...args), `${path} did not return a string`).toBe("string");
    expect(out.trim(), `${path} returned empty`).not.toBe("");
    // Every parameter must actually reach the sentence — a dropped `${n}`
    // is how an order number goes missing on a receipt. Values show up
    // verbatim; the receipt's one boolean flag has to change the wording.
    for (let i = 0; i < fn.length; i += 1) {
      const arg = ARGS[i];
      if (arg === undefined || out.includes(arg)) continue;
      const flipped = String(fn(...args.map((a, j) => (j === i ? false : a))));
      expect(flipped, `${path} ignores argument ${i + 1}`).not.toBe(out);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertCopy(`${path}[${i}]`, v));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertCopy(`${path}.${k}`, v);
    return;
  }
  throw new Error(`${path} is neither copy nor a group of it`);
}

const NAMESPACES = {
  checkout: CHECKOUT_COPY,
  postOrder: POST_ORDER_COPY,
  receipt: RECEIPT_COPY,
  newOrder: NEW_ORDER_COPY,
  newIssue: NEW_ISSUE_COPY,
  reward: REWARD_COPY,
  guestReset: GUEST_RESET_COPY,
  pdf: PDF_COPY,
} as const;

describe("guest copy catalogues", () => {
  for (const [name, catalogue] of Object.entries(NAMESPACES)) {
    it(`${name}: every key is real copy in every UI locale`, () => {
      for (const locale of UI_LOCALES) {
        const copy = catalogue[locale] as Record<string, unknown>;
        expect(copy, `${name}.${locale} missing`).toBeTruthy();
        for (const [key, value] of Object.entries(copy)) {
          assertCopy(`${name}.${locale}.${key}`, value);
        }
      }
    });

    it(`${name}: no locale silently reuses the English string everywhere`, () => {
      // `ar` in the PDF namespace IS English on purpose (decision 4), and
      // a handful of words legitimately match across languages ("Total"),
      // so this only asserts that a locale isn't a wholesale copy of `en`.
      if (name === "pdf") return;
      const enJson = JSON.stringify(catalogue.en, (_k, v) => (typeof v === "function" ? "fn" : v));
      for (const locale of UI_LOCALES.filter((l) => l !== "en")) {
        const other = JSON.stringify(catalogue[locale], (_k, v) =>
          typeof v === "function" ? "fn" : v,
        );
        expect(other, `${name}.${locale} is the English catalogue`).not.toBe(enJson);
      }
    });
  }

  it("accessors collapse region tags and fall back to English", () => {
    expect(checkoutCopy("es-ES").yourOrder).toBe(CHECKOUT_COPY.es.yourOrder);
    expect(postOrderCopy("ar").trackTitle).toBe(POST_ORDER_COPY.ar.trackTitle);
    // `nl` is a venue locale with no catalogue; `xx` is not a locale at
    // all. (This was `fr` until French became a full UI locale, at which
    // point it only still passed because "Total" is the same word in
    // both languages.)
    expect(receiptCopy("nl").total).toBe(RECEIPT_COPY.en.total);
    expect(newOrderCopy("xx").total).toBe(NEW_ORDER_COPY.en.total);
    expect(checkoutCopy(null).total).toBe(CHECKOUT_COPY.en.total);
  });

  it("the PDF renders Arabic orders in English (decision 4)", () => {
    // pdf-lib's StandardFonts cannot encode Arabic script, so the Arabic
    // catalogue entry IS the English one — and the number/date locale
    // follows, or the prices would be stripped to blanks.
    expect(pdfLocale("ar")).toBe("en");
    expect(pdfLocale("ar-EG")).toBe("en");
    expect(pdfCopy("ar")).toBe(PDF_COPY.en);
    expect(pdfCopy("ar").total).toBe("TOTAL");
    expect(pdfCopy("it").total).toBe("TOTALE");
  });

  it("PDF labels fit the fixed-width label column and stay WinAnsi", () => {
    // `receipt-pdf.ts` prints these in a 10-character column with the
    // WinAnsi-only Courier face; anything outside Latin-1 is stripped.
    const labels = ["type", "planned", "name", "phone", "address", "note", "table"] as const;
    for (const locale of UI_LOCALES) {
      const copy = PDF_COPY[locale];
      for (const key of labels) {
        expect(copy[key].length, `pdf.${locale}.${key} too wide`).toBeLessThanOrEqual(10);
      }
      // The catalogue holds plain strings, string arrays (the footer
      // blocks) and — since the reward line started naming the points —
      // one template function. Each is checked as what it renders to.
      for (const value of Object.values(copy).flat()) {
        const rendered = typeof value === "function" ? value("100") : value;
        expect(rendered, `pdf.${locale} has a non-WinAnsi character`).toMatch(/^[\x20-\xFF]*$/);
      }
    }
  });
});
