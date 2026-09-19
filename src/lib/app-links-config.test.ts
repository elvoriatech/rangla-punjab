import { describe, expect, it } from "vitest";
import {
  appLinksConfigSchema,
  appLinksEmpty,
  MAX_APP_LINK_LENGTH,
  normalizeAppLink,
  parseAppLinksConfig,
  publicAppLinks,
} from "./app-links-config";

/**
 * "Get the app" is three URLs, and every bug it can have is a link bug: a
 * badge that goes somewhere other than it says, an `http://` download
 * button the browser blocks, or an owner's paste silently stored as "no
 * app" so the section never appears and nobody can say why.
 */

describe("normalizeAppLink", () => {
  it("takes an App Store listing, in any casing, and stores one spelling", () => {
    expect(normalizeAppLink("https://apps.apple.com/de/app/elvoria/id123456789", "ios")).toBe(
      "https://apps.apple.com/de/app/elvoria/id123456789",
    );
    // Host casing and stray whitespace are the clipboard's doing, not a
    // different link.
    expect(normalizeAppLink("  https://APPS.APPLE.COM/de/app/x/id1  ", "ios")).toBe(
      "https://apps.apple.com/de/app/x/id1",
    );
  });

  it("takes a Play listing with its query string intact", () => {
    const url = "https://play.google.com/store/apps/details?id=com.elvoria.menu&hl=de";
    expect(normalizeAppLink(url, "android")).toBe(url);
  });

  it("refuses a store link pointing at the other store, or anywhere else", () => {
    // The mistake this validation exists to catch: the Play listing pasted
    // into the Apple box, where it would render behind an "App Store" badge.
    expect(normalizeAppLink("https://play.google.com/store/apps/details?id=x", "ios")).toBeNull();
    expect(normalizeAppLink("https://apps.apple.com/de/app/x/id1", "android")).toBeNull();
    expect(normalizeAppLink("https://elvoria.example/app", "ios")).toBeNull();
    // A lookalike host is not the store.
    expect(normalizeAppLink("https://apps.apple.com.evil.example/app", "ios")).toBeNull();
    expect(normalizeAppLink("https://notplay.google.com/store/apps/x", "android")).toBeNull();
  });

  it("takes any https URL for the APK, because the owner hosts that file", () => {
    expect(normalizeAppLink("https://elvoria.example/downloads/app.apk", "apk")).toBe(
      "https://elvoria.example/downloads/app.apk",
    );
    // Not every self-hosted build ends in `.apk` — a signed-URL CDN path is
    // still the file. Accepting any https URL here is deliberate.
    expect(normalizeAppLink("https://cdn.example/d/9f2?token=abc", "apk")).toBe(
      "https://cdn.example/d/9f2?token=abc",
    );
  });

  it("insists on https, everywhere", () => {
    // Mixed content on a TLS menu page — and, for the APK, a download a
    // network can tamper with.
    expect(normalizeAppLink("http://apps.apple.com/de/app/x/id1", "ios")).toBeNull();
    expect(normalizeAppLink("http://elvoria.example/app.apk", "apk")).toBeNull();
    // `market://` opens nothing in a browser.
    expect(normalizeAppLink("market://details?id=com.elvoria", "android")).toBeNull();
    expect(normalizeAppLink("javascript:alert(1)", "apk")).toBeNull();
    expect(normalizeAppLink("apps.apple.com/de/app/x/id1", "ios")).toBeNull();
  });

  it("refuses embedded credentials — never a store link, always a phishing shape", () => {
    expect(normalizeAppLink("https://user:pw@apps.apple.com/de/app/x/id1", "ios")).toBeNull();
    expect(normalizeAppLink("https://user@elvoria.example/app.apk", "apk")).toBeNull();
  });

  it("reads an empty box, a non-string and an over-long paste as no link", () => {
    for (const raw of ["", "   ", null, undefined, 42, {}, ["https://apps.apple.com/x"]]) {
      expect(normalizeAppLink(raw, "apk"), String(raw)).toBeNull();
    }
    const long = `https://elvoria.example/${"a".repeat(MAX_APP_LINK_LENGTH)}.apk`;
    expect(long.length).toBeGreaterThan(MAX_APP_LINK_LENGTH);
    expect(normalizeAppLink(long, "apk")).toBeNull();
  });
});

describe("parseAppLinksConfig", () => {
  it("reads the untouched default as no app published", () => {
    const empty = { ios: null, android: null, apk: null };
    for (const raw of [{}, null, undefined, "nope", 7, []]) {
      expect(parseAppLinksConfig(raw), String(raw)).toEqual(empty);
    }
    expect(appLinksEmpty(parseAppLinksConfig({}))).toBe(true);
  });

  it("keeps the readable slots when a hand-edited row breaks one", () => {
    // The whole point of the tolerant parse: a bad `android` value must
    // cost the venue its Play badge, not its menu.
    expect(
      parseAppLinksConfig({
        ios: "https://apps.apple.com/de/app/x/id1",
        android: "coming soon",
        apk: 12,
      }),
    ).toEqual({
      ios: "https://apps.apple.com/de/app/x/id1",
      android: null,
      apk: null,
    });
  });

  it("never throws, whatever is in the column", () => {
    expect(() => appLinksConfigSchema.parse({ ios: { nested: true } })).not.toThrow();
  });
});

describe("publicAppLinks", () => {
  it("is null when nothing is published, so one check hides the whole feature", () => {
    expect(publicAppLinks(parseAppLinksConfig({}))).toBeNull();
    expect(publicAppLinks(parseAppLinksConfig({ ios: "not a url" }))).toBeNull();
  });

  it("omits the empty slots rather than sending three nulls", () => {
    const config = parseAppLinksConfig({
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
      apk: "https://elvoria.example/app.apk",
    });
    const projected = publicAppLinks(config);
    expect(projected).toEqual({
      android: "https://play.google.com/store/apps/details?id=com.elvoria.menu",
      apk: "https://elvoria.example/app.apk",
    });
    expect(projected).not.toHaveProperty("ios");
  });
});
