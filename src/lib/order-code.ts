/**
 * The public order code: "RP-K7M3Q" (owner, 2026-10-22). It is the ONLY
 * order reference people see — dashboard, board, kitchen tickets, receipts,
 * guest status, mails, pushes, complaints, dispatch. The internal number
 * and series (`order_number`, `order_series`: B-12 / O-7) stay unchanged
 * for accounting, reports and reconciliation; the code is derived from
 * them, so there is no schema change and nothing to backfill.
 *
 * Properties:
 *   - collision-free: (series, number) → code is a bijection — two orders
 *     of the restaurant can never share a code;
 *   - stable: the same order always shows the same code (the alphabet,
 *     scramble constants and prefix must NEVER change — see DECISIONS.md);
 *   - reversible: a code decodes back to (series, number), so search works;
 *   - typo-safe: the last character is a check character (catches any one
 *     wrong character and any swap of two neighbours); no 0/O/1/I/L.
 *
 * Shape: "RP-" + 4 data characters + 1 check (31^4 = 923,521 values, i.e.
 * ~307,000 orders per series). Beyond that the data part grows by one
 * character at a time, up to 6 (a different length can never collide).
 * Pure — the app carries a copy (mobile/src/order-code.ts) that must stay
 * identical.
 */

export const ORDER_CODE_PREFIX = "RP-";
/** 31 characters (a prime — the check character relies on it), without
 *  0 O 1 I L: easy to read out and to type. */
export const ORDER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BASE = ORDER_CODE_ALPHABET.length;
const MIN_DATA = 4;
/** 31^6 needs 30 bits — the Feistel below stays inside exact integers. */
const MAX_DATA = 6;

/** Series as a small integer: legacy (no series) = 0, cash = 1, online = 2. */
const SERIES = [null, "B", "O"] as const;
type Series = (typeof SERIES)[number];

/** Fixed scramble keys (16-bit). Changing any of them changes every code. */
const ROUND_KEYS = [0x5a3c, 0x9e37, 0x2f1b, 0xc6a5, 0x7d21, 0x3b9f];

function seriesIndex(series: string | null | undefined): number {
  if (series === "B") return 1;
  if (series === "O") return 2;
  return 0;
}

/** A keyed bijection on [0, 2^bits) — a small balanced Feistel network. */
function feistel(value: number, bits: number, inverse: boolean): number {
  const half = bits / 2;
  const span = 2 ** half;
  const mask = span - 1;
  let left = Math.floor(value / span) % span;
  let right = value % span;
  const rounds = inverse ? [...ROUND_KEYS].reverse() : ROUND_KEYS;
  for (const key of rounds) {
    const f = (Math.imul(right ^ key, 0x45d9f3b) >>> 7) & mask;
    if (!inverse) {
      [left, right] = [right, (left ^ f) & mask];
    } else {
      [left, right] = [(right ^ ((Math.imul(left ^ key, 0x45d9f3b) >>> 7) & mask)) & mask, left];
    }
  }
  return left * span + right;
}

/** Bijection on [0, size): Feistel on the enclosing even power of two,
 *  "cycle-walked" until the result falls inside the range. */
function permute(value: number, size: number, inverse = false): number {
  let bits = Math.ceil(Math.log2(size));
  if (bits % 2) bits += 1;
  let v = value;
  do {
    v = feistel(v, bits, inverse);
  } while (v >= size);
  return v;
}

/** Weighted sum mod 31 (prime) with distinct weights 1…n: any single
 *  wrong character or swap of two neighbouring characters changes it. */
function checkChar(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + ORDER_CODE_ALPHABET.indexOf(data[i]!) * (i + 1)) % BASE;
  }
  return ORDER_CODE_ALPHABET[sum]!;
}

/** First value of the block that encodes with `len` data characters. */
function blockStart(len: number): number {
  let start = 0;
  for (let l = MIN_DATA; l < len; l++) start += BASE ** l;
  return start;
}

/** "RP-K7M3Q" for an order. */
export function orderCode(series: string | null | undefined, orderNumber: number): string {
  const n = Math.max(0, Math.trunc(orderNumber));
  const value = n * SERIES.length + seriesIndex(series);
  let len = MIN_DATA;
  while (value >= blockStart(len + 1) && len < MAX_DATA) len += 1;
  const size = BASE ** len;
  let v = permute(value - blockStart(len), size);
  let data = "";
  for (let i = 0; i < len; i++) {
    data = ORDER_CODE_ALPHABET[v % BASE]! + data;
    v = Math.floor(v / BASE);
  }
  return `${ORDER_CODE_PREFIX}${data}${checkChar(data)}`;
}

/** The order behind a code, or null when it is not a valid code. Accepts
 *  lower case, missing prefix and spaces/dashes ("rp k7m3q"). */
export function decodeOrderCode(input: string): { series: Series; orderNumber: number } | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  const body = cleaned.startsWith("RP") ? cleaned.slice(2) : cleaned;
  if (body.length < MIN_DATA + 1 || body.length > MAX_DATA + 1) return null;
  const data = body.slice(0, -1);
  if ([...body].some((ch) => !ORDER_CODE_ALPHABET.includes(ch))) return null;
  if (checkChar(data) !== body.slice(-1)) return null;
  let v = 0;
  for (const ch of data) v = v * BASE + ORDER_CODE_ALPHABET.indexOf(ch);
  const value = permute(v, BASE ** data.length, true) + blockStart(data.length);
  return {
    series: SERIES[value % SERIES.length]!,
    orderNumber: Math.floor(value / SERIES.length),
  };
}

/**
 * Turn a stored label into the public code: order history rows written
 * before the codes say "O-12" / "B-3" / "12". Anything else (already a
 * code, or unknown) is returned as it is.
 */
export function displayOrderLabel(label: string | null | undefined): string | null {
  if (!label) return label ?? null;
  const m = /^(?:(B|O)-)?(\d+)$/.exec(label.trim());
  if (!m) return label;
  return orderCode(m[1] ?? null, Number(m[2]));
}
