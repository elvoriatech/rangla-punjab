import { describe, expect, it } from "vitest";
import { appStoreTarget, detectPlatform } from "./app-download";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const IOS_URL = "https://apps.apple.com/de/app/id6815289102";
const PLAY_URL = "https://play.google.com/store/apps/details?id=de.example";

describe("detectPlatform", () => {
  it("reads iPhone and iPad as ios", () => {
    expect(detectPlatform(IPHONE)).toBe("ios");
    expect(detectPlatform(IPAD)).toBe("ios");
  });
  it("reads Android as android", () => {
    expect(detectPlatform(ANDROID)).toBe("android");
  });
  it("reads a desktop, or no header at all, as other", () => {
    expect(detectPlatform(MAC)).toBe("other");
    expect(detectPlatform(null)).toBe("other");
    expect(detectPlatform("")).toBe("other");
  });
});

describe("appStoreTarget", () => {
  const both = { ios: IOS_URL, android: PLAY_URL, apk: null };
  const none = { ios: null, android: null, apk: "https://example.com/app.apk" };

  it("sends each phone to its own store when that link is saved", () => {
    expect(appStoreTarget("ios", both)).toBe(IOS_URL);
    expect(appStoreTarget("android", both)).toBe(PLAY_URL);
  });
  it("returns null (show the page) while a store is still coming soon", () => {
    expect(appStoreTarget("ios", none)).toBeNull();
    expect(appStoreTarget("android", none)).toBeNull();
  });
  it("never redirects a desktop, and never to the .apk", () => {
    expect(appStoreTarget("other", both)).toBeNull();
    expect(appStoreTarget("android", none)).toBeNull();
  });
});
