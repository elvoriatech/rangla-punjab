import { describe, expect, it } from "vitest";
import robots from "./robots";

/**
 * The guest menu is the product, so it must stay crawlable; nothing
 * behind a login or a receipt token should ever land in an index.
 */
describe("robots.txt", () => {
  const rule = () => {
    const r = robots().rules;
    return Array.isArray(r) ? r[0]! : r;
  };

  it("allows the menu", () => {
    expect(rule().allow).toBe("/");
    expect(rule().userAgent).toBe("*");
  });

  it("keeps the consoles out of search results", () => {
    const disallow = rule().disallow as string[];
    for (const path of ["/dashboard/", "/admin/", "/kitchen"]) {
      expect(disallow, `${path} must be disallowed`).toContain(path);
    }
  });

  it("keeps credentialed and token-gated URLs out", () => {
    const disallow = rule().disallow as string[];
    // A shared receipt link should not become an indexed order page.
    for (const path of [
      "/login",
      "/reset",
      "/verify",
      "/account",
      "/pay/",
      "/order-status/",
      "/print/",
      "/api/",
    ]) {
      expect(disallow, `${path} must be disallowed`).toContain(path);
    }
  });

  it("leaves menu photos crawlable for image search", () => {
    expect(rule().disallow as string[]).not.toContain("/img/");
  });

  it("points at the sitemap with an absolute URL", () => {
    const sitemap = robots().sitemap as string;
    expect(sitemap).toMatch(/^https?:\/\/.+\/sitemap\.xml$/);
  });
});
