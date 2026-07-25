"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Uploads a multi-file selection ONE request at a time to `endpoint`, so no
 * single request carries more than one image (no body-limit truncation) and
 * the operator sees per-file progress. Each response is
 * `{ ok, outcome, filename }`; outcomes are tallied and the page is
 * refreshed when the batch finishes.
 */
type Outcome = "attached" | "unmatched" | "replaced" | "saved" | "failed";

const LABELS: Record<Outcome, string> = {
  attached: "attached to a dish",
  unmatched: "no matching dish",
  replaced: "replaced",
  saved: "saved",
  failed: "failed",
};

export function SequentialImageUploader({
  endpoint,
  hint,
}: {
  endpoint: string;
  hint?: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [tally, setTally] = useState<Partial<Record<Outcome, number>>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);

  async function upload(): Promise<void> {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setFinished(false);
    setDone(0);
    setTotal(files.length);
    setTally({});
    setIssues([]);

    for (const file of files) {
      const fd = new FormData();
      fd.append("image", file);
      let outcome: Outcome = "failed";
      try {
        const res = await fetch(endpoint, { method: "POST", body: fd });
        const json = (await res.json().catch(() => ({ ok: false }))) as {
          ok?: boolean;
          outcome?: Outcome;
        };
        outcome = json.ok && json.outcome ? json.outcome : "failed";
      } catch {
        outcome = "failed";
      }
      setTally((t) => ({ ...t, [outcome]: (t[outcome] ?? 0) + 1 }));
      if (outcome === "failed" || outcome === "unmatched") {
        setIssues((prev) => [...prev, file.name]);
      }
      setDone((d) => d + 1);
    }

    setBusy(false);
    setFinished(true);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div>
      {hint}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        className="mt-2 block w-full text-xs text-neutral-400 file:mr-2 file:border file:border-white/20 file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-neutral-300"
      />
      <button
        type="button"
        onClick={upload}
        disabled={busy}
        className="mt-3 border border-white/15 px-4 py-1.5 text-xs uppercase tracking-wider text-neutral-200 hover:border-admin-accent/50 hover:text-white disabled:opacity-50"
      >
        {busy ? `Uploading ${done}/${total}…` : "Upload photos"}
      </button>

      {busy ? (
        <p className="mt-2 text-xs text-neutral-400" role="status">
          Uploading {done} of {total}…
        </p>
      ) : null}
      {finished && !busy ? (
        <p className="mt-2 text-xs text-emerald-300" role="status">
          Done — {total} file(s):{" "}
          {(Object.keys(tally) as Outcome[]).map((k, i) => (
            <span key={k}>
              {i > 0 ? ", " : ""}
              {tally[k]} {LABELS[k]}
            </span>
          ))}
          {issues.length > 0 ? (
            <span className="text-admin-accent"> · check: {issues.join(", ")}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
