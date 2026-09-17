import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cacheRoot,
  deleteVariants,
  getOrCreateVariant,
  inFlightCount,
  readVariant,
  variantPath,
  writeVariant,
} from "./image-cache";

const KEY = "tenant-1/uploads/1d7c0f8e-aaaa-bbbb-cccc-000000000001";

/**
 * A fresh storage key per test. The in-flight map is module-level by
 * design (one process, one shared encode), so tests must not share a
 * dedupe key or a pending encode in one leaks into the next.
 */
let keySeq = 0;
function uniqueKey(): string {
  keySeq += 1;
  return `tenant-1/uploads/00000000-0000-0000-0000-${String(keySeq).padStart(12, "0")}`;
}

/** Let pending `readVariant` disk reads settle before asserting. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

let dir: string;
let previous: string | undefined;

beforeEach(async () => {
  previous = process.env.IMAGE_CACHE_DIR;
  dir = await mkdtemp(path.join(tmpdir(), "img-cache-test-"));
  process.env.IMAGE_CACHE_DIR = dir;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.IMAGE_CACHE_DIR;
  else process.env.IMAGE_CACHE_DIR = previous;
  await rm(dir, { recursive: true, force: true });
});

describe("cache location", () => {
  it("honours IMAGE_CACHE_DIR", () => {
    expect(cacheRoot()).toBe(dir);
  });

  it("defaults outside public/uploads so variants stay out of backups", () => {
    delete process.env.IMAGE_CACHE_DIR;
    const root = cacheRoot();
    expect(root).toBe(path.join(process.cwd(), ".image-cache"));
    expect(root).not.toContain(path.join("public", "uploads"));
  });

  it("mirrors the storage key so a prefix delete reaches the variants", () => {
    expect(variantPath(KEY, 480, "avif")).toBe(path.join(dir, KEY, "480.avif"));
  });

  it("refuses a key that escapes the cache root", () => {
    expect(() => variantPath("../../etc/passwd", 480, "webp")).toThrow(/escapes cache root/);
  });
});

describe("read/write", () => {
  it("returns null before anything is cached", async () => {
    expect(await readVariant(KEY, 480, "webp")).toBeNull();
  });

  it("round-trips bytes", async () => {
    const bytes = Buffer.from("resized-webp-bytes");
    expect(await writeVariant(KEY, 480, "webp", bytes)).toBe(true);
    expect(await readVariant(KEY, 480, "webp")).toEqual(bytes);
  });

  it("keeps widths and formats in separate slots", async () => {
    await writeVariant(KEY, 480, "webp", Buffer.from("a"));
    await writeVariant(KEY, 960, "webp", Buffer.from("b"));
    await writeVariant(KEY, 480, "avif", Buffer.from("c"));

    expect(await readVariant(KEY, 480, "webp")).toEqual(Buffer.from("a"));
    expect(await readVariant(KEY, 960, "webp")).toEqual(Buffer.from("b"));
    expect(await readVariant(KEY, 480, "avif")).toEqual(Buffer.from("c"));
  });

  it("leaves no .tmp files behind — a reader never sees a partial image", async () => {
    await writeVariant(KEY, 480, "webp", Buffer.from("x".repeat(4096)));
    const entries = await readdir(path.join(dir, KEY));
    expect(entries).toEqual(["480.webp"]);
  });

  it("reports failure instead of throwing when the cache is unwritable", async () => {
    // A FILE where the variant directory needs to be: mkdir fails.
    const blocked = "tenant-1/uploads/blocked";
    await mkdir(path.join(dir, "tenant-1", "uploads"), { recursive: true });
    await writeFile(path.join(dir, "tenant-1", "uploads", "blocked"), "not-a-directory");

    expect(await writeVariant(blocked, 480, "webp", Buffer.from("y"))).toBe(false);
  });
});

describe("getOrCreateVariant", () => {
  it("produces once, then serves from disk", async () => {
    const key = uniqueKey();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return Buffer.from("encoded");
    };

    expect(await getOrCreateVariant(key, 480, "webp", produce)).toEqual(Buffer.from("encoded"));
    expect(await getOrCreateVariant(key, 480, "webp", produce)).toEqual(Buffer.from("encoded"));
    expect(calls).toBe(1);
    await expect(stat(variantPath(key, 480, "webp"))).resolves.toBeDefined();
  });

  it("de-duplicates concurrent requests for the same variant", async () => {
    const key = uniqueKey();
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const produce = async () => {
      calls += 1;
      await gate;
      return Buffer.from("encoded-once");
    };

    // Ten guests scanning the QR code at the same moment.
    const all = Promise.all(
      Array.from({ length: 10 }, () => getOrCreateVariant(key, 480, "avif", produce)),
    );
    try {
      // Each call first awaits a cache read, so the map is populated a
      // tick later — not synchronously with the call.
      await tick();
      expect(inFlightCount()).toBe(1);
    } finally {
      // Release even on failure: a stuck promise under this dedupe key
      // would otherwise hang every later test that touches it.
      release();
    }

    const results = await all;
    expect(calls).toBe(1);
    for (const r of results) expect(r).toEqual(Buffer.from("encoded-once"));
    expect(inFlightCount()).toBe(0);
  });

  it("still parallelises different variants", async () => {
    const key = uniqueKey();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return Buffer.from("v");
    };
    await Promise.all([
      getOrCreateVariant(key, 480, "webp", produce),
      getOrCreateVariant(key, 960, "webp", produce),
      getOrCreateVariant(key, 480, "avif", produce),
    ]);
    expect(calls).toBe(3);
  });

  it("propagates a producer failure to every waiter and caches nothing", async () => {
    const key = uniqueKey();
    let calls = 0;
    const boom = async (): Promise<Buffer> => {
      calls += 1;
      throw new Error("undecodable");
    };

    const settled = await Promise.allSettled([
      getOrCreateVariant(key, 480, "webp", boom),
      getOrCreateVariant(key, 480, "webp", boom),
    ]);
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(calls).toBe(1);
    expect(await readVariant(key, 480, "webp")).toBeNull();
    expect(inFlightCount()).toBe(0);
  });

  it("retries cleanly after a failure", async () => {
    const key = uniqueKey();
    await getOrCreateVariant(key, 480, "webp", async () => {
      throw new Error("transient");
    }).catch(() => {});

    expect(await getOrCreateVariant(key, 480, "webp", async () => Buffer.from("ok"))).toEqual(
      Buffer.from("ok"),
    );
  });

  it("serves the response even when the cache write fails", async () => {
    const blocked = "tenant-1/uploads/blocked";
    await mkdir(path.join(dir, "tenant-1", "uploads"), { recursive: true });
    await writeFile(path.join(dir, "tenant-1", "uploads", "blocked"), "not-a-directory");

    expect(await getOrCreateVariant(blocked, 480, "webp", async () => Buffer.from("z"))).toEqual(
      Buffer.from("z"),
    );
  });
});

describe("deleteVariants", () => {
  it("drops every variant of one key", async () => {
    await writeVariant(KEY, 480, "webp", Buffer.from("a"));
    await writeVariant(KEY, 960, "avif", Buffer.from("b"));

    await deleteVariants(KEY);

    expect(await readVariant(KEY, 480, "webp")).toBeNull();
    expect(await readVariant(KEY, 960, "avif")).toBeNull();
  });

  it("drops a whole tenant prefix", async () => {
    const other = "tenant-1/uploads/1d7c0f8e-aaaa-bbbb-cccc-000000000002";
    await writeVariant(KEY, 480, "webp", Buffer.from("a"));
    await writeVariant(other, 480, "webp", Buffer.from("b"));

    await deleteVariants("tenant-1");

    expect(await readVariant(KEY, 480, "webp")).toBeNull();
    expect(await readVariant(other, 480, "webp")).toBeNull();
  });

  it("is a no-op for a key that was never cached", async () => {
    await expect(deleteVariants("tenant-9/uploads/nope")).resolves.toBeUndefined();
  });
});
