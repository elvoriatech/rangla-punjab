"use client";

import { useState } from "react";

/**
 * Delivery-areas editor: one row per ZIP with its fee/minimum/free-over. An
 * explicit "Add area" button (no more guessing the trailing blank row) and a
 * per-row remove. Typing a ZIP auto-fills the locality from a free lookup
 * (/api/zip-lookup) unless the owner already typed one. Input names stay
 * contiguous (areaZip_0…N) so the existing save action parses them unchanged.
 */

interface AreaInput {
  zip: string;
  locality: string;
  feeCents: number;
  minCents: number;
  freeOverCents: number;
}
interface Row {
  id: number;
  zip: string;
  locality: string;
  fee: string;
  min: string;
  freeOver: string;
  /** Locality came from the ZIP lookup (not typed) — safe to replace
   *  when the owner changes the ZIP. */
  autoLocality?: boolean;
}

const euros = (cents: number): string => (cents / 100).toFixed(2);
const field = "border border-ink/30 bg-white px-2 py-1.5 text-sm outline-none focus:border-ink";

export function DeliveryAreasEditor({ initial }: { initial: AreaInput[] }): React.ReactElement {
  const seed: Row[] = initial.map((a, i) => ({
    id: i,
    zip: a.zip,
    locality: a.locality,
    fee: euros(a.feeCents),
    min: euros(a.minCents),
    freeOver: a.freeOverCents > 0 ? euros(a.freeOverCents) : "",
  }));
  const [rows, setRows] = useState<Row[]>(
    seed.length > 0 ? seed : [{ id: 0, zip: "", locality: "", fee: "", min: "", freeOver: "" }],
  );
  const [nextId, setNextId] = useState(seed.length > 0 ? seed.length : 1);
  const [looking, setLooking] = useState<number | null>(null);

  const patch = (id: number, p: Partial<Row>): void =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const addRow = (): void => {
    setRows((rs) => [...rs, { id: nextId, zip: "", locality: "", fee: "", min: "", freeOver: "" }]);
    setNextId((n) => n + 1);
  };
  const removeRow = (id: number): void => setRows((rs) => rs.filter((r) => r.id !== id));

  async function lookup(id: number, zip: string, row: Row): Promise<void> {
    const z = zip.trim();
    // Only fill an empty locality or replace one WE filled earlier —
    // never overwrite a name the owner typed.
    if (!/^\d{4,5}$/.test(z) || (row.locality.trim() && !row.autoLocality)) return;
    setLooking(id);
    try {
      const res = await fetch(`/api/zip-lookup?zip=${encodeURIComponent(z)}`);
      const json = (await res.json().catch(() => ({}))) as { locality?: string | null };
      if (json.locality) patch(id, { locality: json.locality, autoLocality: true });
    } catch {
      // Leave the locality for manual entry.
    } finally {
      setLooking(null);
    }
  }

  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[600px] items-center gap-x-3 gap-y-2 text-xs"
          style={{ gridTemplateColumns: "92px 1fr 88px 96px 116px 34px" }}
        >
          <span className="font-medium uppercase tracking-wider text-muted">ZIP</span>
          <span className="font-medium uppercase tracking-wider text-muted">Area / locality</span>
          <span className="font-medium uppercase tracking-wider text-muted">Fee €</span>
          <span className="font-medium uppercase tracking-wider text-muted">Min. €</span>
          <span className="font-medium uppercase tracking-wider text-muted">
            Free from € (0 = off)
          </span>
          <span />
          {rows.map((r, i) => (
            <div key={r.id} className="contents">
              <input
                type="text"
                name={`areaZip_${i}`}
                value={r.zip}
                onChange={(e) => {
                  const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
                  patch(r.id, { zip });
                  // Look up as soon as a complete PLZ is typed — no need
                  // to leave the field first.
                  if (zip.length === 5) void lookup(r.id, zip, r);
                }}
                onBlur={(e) => void lookup(r.id, e.target.value, r)}
                placeholder="78467"
                maxLength={5}
                inputMode="numeric"
                autoComplete="postal-code"
                className={field}
              />
              <input
                type="text"
                name={`areaLocality_${i}`}
                value={looking === r.id && !r.locality ? "" : r.locality}
                onChange={(e) => patch(r.id, { locality: e.target.value, autoLocality: false })}
                placeholder={looking === r.id ? "Looking up…" : "Konstanz"}
                maxLength={80}
                className={field}
              />
              <input
                type="number"
                name={`areaFee_${i}`}
                min={0}
                step="0.10"
                value={r.fee}
                onChange={(e) => patch(r.id, { fee: e.target.value })}
                placeholder="0.00"
                className={field}
              />
              <input
                type="number"
                name={`areaMin_${i}`}
                min={0}
                step="0.50"
                value={r.min}
                onChange={(e) => patch(r.id, { min: e.target.value })}
                placeholder="0.00"
                className={field}
              />
              <input
                type="number"
                name={`areaFreeOver_${i}`}
                min={0}
                step="0.50"
                value={r.freeOver}
                onChange={(e) => patch(r.id, { freeOver: e.target.value })}
                placeholder="0.00"
                className={field}
              />
              <button
                type="button"
                onClick={() => removeRow(r.id)}
                aria-label={`Remove ${r.zip || "row"}`}
                title="Remove area"
                className="flex h-8 w-8 items-center justify-center border border-ink/20 text-ink/50 hover:border-red-700 hover:text-red-700"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-3 border border-ink/25 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-ink hover:border-orange hover:text-orange"
      >
        + Add area
      </button>
    </div>
  );
}
