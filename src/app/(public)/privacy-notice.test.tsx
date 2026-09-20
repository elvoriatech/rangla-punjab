import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PRIVACY_ACK_KEY, PrivacyNotice } from "./privacy-notice";
import { MENU_COPY, menuCopy } from "@/lib/i18n/menu";
import { UI_LOCALES } from "@/lib/locales";

/**
 * Server-side only. This repo's vitest runs on `environment: "node"` with
 * no jsdom / testing-library (see `vitest.config.ts`), so there is no DOM
 * to mount into and the effect that reads `localStorage` cannot run here.
 * What IS worth proving without a DOM — and what these cover — is the
 * half that a static, edge-cached page depends on: the notice contributes
 * NOTHING to the server HTML, and every locale has the words it needs.
 * The open/dismiss behaviour is exercised in the browser, not here.
 */
describe("PrivacyNotice", () => {
  it("renders nothing on the server, in every locale", () => {
    for (const locale of UI_LOCALES) {
      const html = renderToStaticMarkup(<PrivacyNotice labels={menuCopy(locale).privacy} />);
      expect(html, `locale ${locale} rendered server HTML`).toBe("");
    }
  });

  it("leaks none of its copy into the server output", () => {
    const t = menuCopy("en");
    const html = renderToStaticMarkup(<PrivacyNotice labels={t.privacy} />);
    expect(html).not.toContain(t.privacy.title);
    expect(html).not.toContain(t.privacy.body);
    expect(html).not.toContain(t.privacy.link);
    expect(html).not.toContain(t.privacy.ok);
  });

  it("uses one versioned, app-scoped storage key", () => {
    // Versioned so re-worded copy can ask again; namespaced so it cannot
    // collide with the basket's own keys in the same origin.
    expect(PRIVACY_ACK_KEY).toBe("rp.privacy.ack.v1");
    expect(PRIVACY_ACK_KEY).toMatch(/\.v\d+$/);
  });

  it("has title, body, policy link and acknowledgement in all five locales", () => {
    for (const locale of UI_LOCALES) {
      const { privacy } = MENU_COPY[locale];
      for (const [key, value] of Object.entries(privacy)) {
        expect(typeof value, `${locale}.privacy.${key}`).toBe("string");
        expect(value.trim(), `${locale}.privacy.${key} is blank`).not.toBe("");
      }
    }
    // It must say what it is about: no cookie, device-local storage.
    expect(MENU_COPY.en.privacy.body).toMatch(/cookies/i);
    expect(MENU_COPY.de.privacy.body).toMatch(/Cookies/);
  });
});
