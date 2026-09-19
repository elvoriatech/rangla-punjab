import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMenuPurgeUrls, purgeUrls } from "./cdn-purge";

describe("buildMenuPurgeUrls", () => {
  it("covers the root menu, every enabled locale, the manifest, and the app's API read", () => {
    const urls = buildMenuPurgeUrls(["de", "en"]);
    expect(urls).toEqual([
      "http://localhost:3000/",
      "http://localhost:3000/de",
      "http://localhost:3000/en",
      "http://localhost:3000/manifest.webmanifest",
      "http://localhost:3000/api/v1/menu",
      "http://localhost:3000/api/v1/menu?locale=de",
      "http://localhost:3000/api/v1/menu?locale=en",
    ]);
  });

  it("returns the root menu, manifest and API read when no extra locales", () => {
    expect(buildMenuPurgeUrls([])).toEqual([
      "http://localhost:3000/",
      "http://localhost:3000/manifest.webmanifest",
      "http://localhost:3000/api/v1/menu",
    ]);
  });

  it("purges the app's menu endpoint, not only the website — the app reads a different URL", () => {
    // Regression guard for the failure it prevents: hours saved, website
    // correct, app still showing yesterday's open/closed state because
    // nothing ever purged /api/v1/menu.
    const urls = buildMenuPurgeUrls(["fr"]);
    expect(urls).toContain("http://localhost:3000/api/v1/menu");
    expect(urls).toContain("http://localhost:3000/api/v1/menu?locale=fr");
  });
});

describe("purgeUrls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no-ops cleanly when the CDN is not configured (dev/self-hosted)", async () => {
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const fetchSpy = vi.fn();
    expect(await purgeUrls(["http://x/r/a"], fetchSpy)).toBe("skipped_unconfigured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the URL list to Cloudflare's purge endpoint when configured", async () => {
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone123");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "tok");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    expect(await purgeUrls(["http://x/r/a", "http://x/r/a/de"], fetchSpy)).toBe("purged");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone123/purge_cache",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
        body: JSON.stringify({ files: ["http://x/r/a", "http://x/r/a/de"] }),
      }),
    );
  });

  it("reports failure without throwing — a failed purge must never fail the save", async () => {
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone123");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "tok");
    expect(
      await purgeUrls(["http://x/r/a"], vi.fn().mockResolvedValue({ ok: false, status: 403 })),
    ).toBe("failed");
    expect(
      await purgeUrls(["http://x/r/a"], vi.fn().mockRejectedValue(new Error("net down"))),
    ).toBe("failed");
  });
});
