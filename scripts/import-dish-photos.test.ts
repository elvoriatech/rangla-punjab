import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_DOWNLOAD_BYTES,
  checkContentType,
  checkUrl,
  downloadImage,
  matchVersion,
  type ImageFetch,
  type PhotoRow,
  type TargetVersion,
} from "./import-dish-photos";

/**
 * The two things that can silently go wrong here, both covered without a
 * network or a database:
 *
 *  1. the intake gate — a share link that serves an HTML page, a GIF, a
 *     `file://` path or a 400 MB original must be refused with a message
 *     naming the dish, not fed to sharp or buffered into memory;
 *  2. the matcher — the ids in the bundle come from PRODUCTION's published
 *     menu, so on the draft (and on any other database) the exact-name
 *     fallback is the only thing that resolves a dish. A mis-pairing here
 *     puts the wrong photo on the wrong plate.
 */

function res(
  body: BodyInit | null,
  init: { status?: number; contentType?: string | null; contentLength?: string } = {},
): Response {
  const headers = new Headers();
  if (init.contentType !== null) headers.set("content-type", init.contentType ?? "image/jpeg");
  if (init.contentLength) headers.set("content-length", init.contentLength);
  return new Response(body, { status: init.status ?? 200, headers });
}

function fetchReturning(response: Response): ImageFetch {
  return vi.fn(async () => response);
}

describe("checkUrl", () => {
  it("accepts http and https", () => {
    expect(checkUrl("https://cdn.example/dish.jpg")).toEqual({
      ok: true,
      url: "https://cdn.example/dish.jpg",
    });
    expect(checkUrl("  http://localhost:58816/dish_1_sq-640.webp  ").ok).toBe(true);
  });

  it("refuses schemes that are not a download", () => {
    for (const raw of ["file:///etc/passwd", "data:image/png;base64,AAAA", "ftp://x/y.jpg"]) {
      const result = checkUrl(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/unsupported scheme/);
    }
  });

  it("refuses something that is not a URL at all", () => {
    const result = checkUrl("dish_1.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a URL/);
  });
});

describe("checkContentType", () => {
  it("accepts the three the dashboard accepts, parameters and case included", () => {
    for (const type of ALLOWED_CONTENT_TYPES) {
      expect(checkContentType(type)).toEqual({ ok: true, contentType: type });
    }
    expect(checkContentType("IMAGE/JPEG; charset=binary")).toEqual({
      ok: true,
      contentType: "image/jpeg",
    });
  });

  it("refuses an HTML share page, a GIF and a missing header", () => {
    const html = checkContentType("text/html; charset=utf-8");
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.reason).toMatch(/share\/preview link/);

    expect(checkContentType("image/gif").ok).toBe(false);
    expect(checkContentType("application/pdf").ok).toBe(false);

    const missing = checkContentType(null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/no Content-Type/);
  });
});

describe("downloadImage", () => {
  it("returns the bytes for a well-formed image response", async () => {
    const body = Buffer.from("not really a jpeg, but sharp is not involved yet");
    const result = await downloadImage(
      "https://cdn.example/dish.jpg",
      fetchReturning(res(body, { contentType: "image/jpeg" })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("image/jpeg");
      expect(result.bytes.equals(body)).toBe(true);
    }
  });

  it("follows redirects rather than treating a 3xx as an error", async () => {
    const impl = vi.fn(async () => res(Buffer.from("bytes"))) as ImageFetch;
    await downloadImage("https://cdn.example/dish.jpg", impl);
    expect(impl).toHaveBeenCalledWith(
      "https://cdn.example/dish.jpg",
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("refuses a non-2xx", async () => {
    const result = await downloadImage(
      "https://cdn.example/gone.jpg",
      fetchReturning(res(null, { status: 404 })),
    );
    expect(result).toEqual({ ok: false, reason: "HTTP 404" });
  });

  it("refuses a wrong content type before reading the body", async () => {
    const result = await downloadImage(
      "https://drive.example/file/d/abc/view",
      fetchReturning(res("<html>Sign in</html>", { contentType: "text/html" })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/text\/html/);
  });

  it("refuses an oversized download on the declared length", async () => {
    const result = await downloadImage(
      "https://cdn.example/huge.png",
      fetchReturning(
        res(Buffer.from("tiny"), {
          contentType: "image/png",
          contentLength: String(MAX_DOWNLOAD_BYTES + 1),
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/declared — the limit is/);
  });

  it("refuses an oversized download whose Content-Length lied", async () => {
    const result = await downloadImage(
      "https://cdn.example/huge.webp",
      fetchReturning(
        res(Buffer.alloc(MAX_DOWNLOAD_BYTES + 1024), {
          contentType: "image/webp",
          contentLength: "512",
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stopped mid-download/);
  });

  it("refuses an empty body", async () => {
    const result = await downloadImage(
      "https://cdn.example/empty.jpg",
      fetchReturning(res(Buffer.alloc(0))),
    );
    expect(result).toEqual({ ok: false, reason: "empty response body" });
  });

  it("reports a transport failure instead of throwing", async () => {
    const impl: ImageFetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND cdn.example");
    };
    const result = await downloadImage("https://cdn.example/dish.jpg", impl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/request failed — getaddrinfo/);
  });
});

describe("matchVersion", () => {
  const rows: PhotoRow[] = [
    {
      id: "prod-thali-mo",
      category: "Thali",
      name: "Vegetarisches Thali – Montag",
      imageUrl: "https://cdn.example/a.jpg",
    },
    {
      id: "prod-korma-veg",
      category: "Vegetarisch",
      name: "Chicken Korma",
      imageUrl: "https://cdn.example/b.jpg",
    },
  ];

  /** The published tree: same ids as the bundle, one dish photographed. */
  const published: TargetVersion = {
    id: "v-pub",
    label: "published",
    categories: [
      {
        id: "c-thali",
        name: "Thali",
        items: [
          { id: "prod-thali-mo", name: "Vegetarisches Thali – Montag", photoMediaId: null },
          { id: "prod-thali-di", name: "Vegetarisches Thali – Dienstag", photoMediaId: "m1" },
        ],
      },
      {
        id: "c-fleisch",
        name: "Fleisch",
        items: [{ id: "pub-korma-meat", name: "Chicken Korma", photoMediaId: null }],
      },
      {
        id: "c-veg",
        name: "Vegetarisch",
        items: [{ id: "prod-korma-veg", name: "Chicken Korma", photoMediaId: "m2" }],
      },
    ],
  };

  /** The draft: a publish deep-copies the tree, so NO id is shared. */
  const draft: TargetVersion = {
    id: "v-draft",
    label: "draft",
    categories: [
      {
        id: "d-thali",
        name: "Thali",
        items: [{ id: "draft-thali-mo", name: "Vegetarisches Thali – Montag", photoMediaId: null }],
      },
      {
        id: "d-fleisch",
        name: "Fleisch",
        items: [{ id: "draft-korma-meat", name: "Chicken Korma", photoMediaId: null }],
      },
      {
        id: "d-veg",
        name: "Vegetarisch",
        items: [{ id: "draft-korma-veg", name: "Chicken Korma", photoMediaId: null }],
      },
    ],
  };

  it("matches by id when the ids are the bundle's own", () => {
    expect(matchVersion(rows, published)).toEqual([
      { itemId: "prod-thali-mo", how: "id", hasPhoto: false },
      { itemId: "prod-korma-veg", how: "id", hasPhoto: true },
    ]);
  });

  it("falls back to the exact name inside the row's own category", () => {
    expect(matchVersion(rows, draft)).toEqual([
      { itemId: "draft-thali-mo", how: "name", hasPhoto: false },
      // NOT draft-korma-meat: "Chicken Korma" exists under Fleisch too.
      { itemId: "draft-korma-veg", how: "name", hasPhoto: false },
    ]);
  });

  it("reports the dish's existing photo so --overwrite can gate on it", () => {
    const [thali, korma] = matchVersion(rows, published);
    expect(thali?.hasPhoto).toBe(false);
    expect(korma?.hasPhoto).toBe(true);
  });

  it("does not match a row whose category is absent or whose name differs", () => {
    const stray: PhotoRow[] = [
      { id: "x", category: "Desserts", name: "Gulab Jamun", imageUrl: "https://e/x.jpg" },
      {
        id: "y",
        category: "Thali",
        name: "Vegetarisches Thali - Montag",
        imageUrl: "https://e/y.jpg",
      },
    ];
    expect(matchVersion(stray, published)).toEqual([null, null]);
  });

  it("never pairs two bundle rows with the same dish", () => {
    const duplicated: PhotoRow[] = [
      { ...rows[0]!, id: "unknown-1" },
      { ...rows[0]!, id: "unknown-2" },
    ];
    const result = matchVersion(duplicated, draft);
    expect(result[0]).toEqual({ itemId: "draft-thali-mo", how: "name", hasPhoto: false });
    expect(result[1]).toBeNull();
  });

  it("claims every id match before any name match, whatever the row order", () => {
    // Row 0 would happily take `prod-thali-di` by name; row 1 owns it by id.
    const contested: PhotoRow[] = [
      {
        id: "no-such-id",
        category: "Thali",
        name: "Vegetarisches Thali – Dienstag",
        imageUrl: "https://e/a.jpg",
      },
      {
        id: "prod-thali-di",
        category: "Thali",
        name: "Vegetarisches Thali – Dienstag",
        imageUrl: "https://e/b.jpg",
      },
    ];
    const result = matchVersion(contested, published);
    expect(result[1]).toEqual({ itemId: "prod-thali-di", how: "id", hasPhoto: true });
    expect(result[0]).toBeNull();
  });
});
