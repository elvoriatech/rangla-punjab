import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLastOrders,
  LAST_ORDER_EVENT,
  readLastOrder,
  readLastOrders,
  rememberOrder,
  subscribeLastOrders,
} from "./last-order-store";

/**
 * The website's only memory of an order this browser placed.
 *
 * The properties worth pinning are the defensive ones: this reads a
 * `localStorage` key that a guest can edit, on a device whose storage may
 * refuse every write, and what it hands back is used to build a URL
 * carrying a bearer token. Anything it cannot vouch for has to come back
 * as "no order" rather than as a half-built link.
 */

const SLUG = "rangla-punjab";
const KEY = `rangla-last-orders:${SLUG}`;

/** A minimal in-memory `localStorage`, so a failing write can be staged. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v);
    },
    removeItem: (k: string): void => {
      map.delete(k);
    },
  };
  vi.stubGlobal("window", {
    localStorage: store,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  return map;
}

const order = (n: number): { orderId: string; receiptToken: string; placedAt: string } => ({
  orderId: `order-${n}`,
  receiptToken: `token-${n}`,
  placedAt: new Date(2026, 0, n).toISOString(),
});

describe("last-order-store", () => {
  let raw: Map<string, string>;

  beforeEach(() => {
    raw = installStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers an order and hands the newest one back", () => {
    expect(readLastOrder(SLUG)).toBeNull();

    rememberOrder(SLUG, order(1));
    rememberOrder(SLUG, order(2));

    expect(readLastOrder(SLUG)).toMatchObject({ orderId: "order-2", receiptToken: "token-2" });
    expect(readLastOrders(SLUG).map((o) => o.orderId)).toEqual(["order-2", "order-1"]);
  });

  it("keeps the last five and no more", () => {
    for (let n = 1; n <= 8; n += 1) rememberOrder(SLUG, order(n));
    const ids = readLastOrders(SLUG).map((o) => o.orderId);
    expect(ids).toEqual(["order-8", "order-7", "order-6", "order-5", "order-4"]);
  });

  it("does not store the same order twice when a submit is retried", () => {
    rememberOrder(SLUG, order(1));
    rememberOrder(SLUG, order(2));
    // The wallet path can commit the same order again after the charge.
    rememberOrder(SLUG, order(1));
    expect(readLastOrders(SLUG).map((o) => o.orderId)).toEqual(["order-1", "order-2"]);
  });

  it("is scoped per venue — one restaurant's order never answers another's", () => {
    rememberOrder(SLUG, order(1));
    expect(readLastOrder("some-other-venue")).toBeNull();
  });

  it("ignores anything in the key it cannot vouch for", () => {
    // A hand-edited or half-written value must not produce a link with a
    // missing token in it.
    for (const junk of [
      "not json",
      '{"orderId":"o1"}',
      "[]",
      '[{"orderId":"o1"}]',
      '[{"receiptToken":"t1","placedAt":"x"}]',
      '[{"orderId":"","receiptToken":"t1","placedAt":"x"}]',
      '[{"orderId":"o1","receiptToken":1,"placedAt":"x"}]',
      "null",
    ]) {
      raw.set(KEY, junk);
      expect(readLastOrder(SLUG), junk).toBeNull();
    }

    // One good entry beside a bad one survives on its own.
    raw.set(KEY, '[{"bad":true},{"orderId":"o9","receiptToken":"t9","placedAt":"x"}]');
    expect(readLastOrders(SLUG).map((o) => o.orderId)).toEqual(["o9"]);
  });

  it("degrades to 'no order' when storage throws rather than propagating", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    });
    expect(() => rememberOrder(SLUG, order(1))).not.toThrow();
    expect(readLastOrders(SLUG)).toEqual([]);
    expect(() => clearLastOrders(SLUG)).not.toThrow();
  });

  it("forgets on request", () => {
    rememberOrder(SLUG, order(1));
    clearLastOrders(SLUG);
    expect(readLastOrder(SLUG)).toBeNull();
  });

  it("subscribes and unsubscribes on both the write and the cross-tab event", () => {
    const added: string[] = [];
    const removed: string[] = [];
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      addEventListener: (name: string) => added.push(name),
      removeEventListener: (name: string) => removed.push(name),
      dispatchEvent: () => true,
    });
    const unsubscribe = subscribeLastOrders(() => {});
    expect(added).toEqual([LAST_ORDER_EVENT, "storage"]);
    unsubscribe();
    expect(removed).toEqual([LAST_ORDER_EVENT, "storage"]);
  });
});
