"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Audible new-order alert for the kitchen display and the dashboard
 * orders page — the BYOD answer to the beeping Lieferando tablet. The
 * pages already re-render on a poll (AutoRefresh); this component
 * watches the open-order count and plays the selected sound when it
 * rises.
 *
 * Sounds are WebAudio-synthesized (no assets to load, works offline on
 * a kitchen tablet) and selectable per device: a quiet café wants the
 * short ding, a loud Friday-night kitchen wants the alarm. Picking a
 * sound previews it — which doubles as the user gesture browsers
 * require before a page may make noise (autoplay policy).
 */

const ENABLED_KEY = "guesto.chime";
const SOUND_KEY = "guesto.chime.sound";
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

function setEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // Private mode — the toggle still works for this page view.
  }
  notify();
}

/* ------------------------------------------------------------------ */
/* Sounds                                                              */
/* ------------------------------------------------------------------ */

type SoundId = "ding" | "bell" | "alarm" | "door" | "ringring";

const SOUND_IDS: readonly SoundId[] = ["ding", "bell", "alarm", "door", "ringring"];

const SOUND_LABELS: Record<SoundId, string> = {
  ding: "Ding (short)",
  bell: "Bell (long)",
  alarm: "Alarm (loud)",
  door: "Door bell",
  ringring: "Ring-ring",
};

/** Recorded sounds served from /public; synthesized ones are in PLAYERS. */
const SOUND_FILES: Partial<Record<SoundId, string>> = {
  door: "/sounds/door-bell.mp3",
  ringring: "/sounds/ringring-bell.mp3",
};

// Recordings are capped so a busy evening never stacks half-minute
// bells on top of each other; a fresh order also cuts the previous ring.
const FILE_MAX_SECONDS = 5;

function readSound(): SoundId {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return (SOUND_IDS as readonly string[]).includes(v ?? "") ? (v as SoundId) : "bell";
  } catch {
    return "bell";
  }
}

function setSound(id: SoundId): void {
  try {
    localStorage.setItem(SOUND_KEY, id);
  } catch {
    // Private mode — see above.
  }
  notify();
}

let ctx: AudioContext | null = null;

function tone(
  ac: AudioContext,
  opts: { freq: number; at: number; dur: number; gain: number; type?: OscillatorType },
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.value = opts.freq;
  const t = ac.currentTime + opts.at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

const PLAYERS: Record<"ding" | "bell" | "alarm", (ac: AudioContext) => void> = {
  // Two quick rising notes, ~0.7s — polite front-of-house ping.
  ding(ac) {
    tone(ac, { freq: 880, at: 0, dur: 0.5, gain: 0.4 });
    tone(ac, { freq: 1318.5, at: 0.18, dur: 0.5, gain: 0.4 });
  },
  // Three strikes with long decays + a low body, ~2.5s — the default:
  // long enough to catch someone walking away from the tablet.
  bell(ac) {
    for (const [i, at] of [0, 0.5, 1.0].entries()) {
      tone(ac, { freq: 1046.5, at, dur: 1.4, gain: 0.45 - i * 0.08 });
      tone(ac, { freq: 1568, at: at + 0.02, dur: 1.1, gain: 0.22 - i * 0.04 });
      tone(ac, { freq: 523.25, at, dur: 1.5, gain: 0.18, type: "triangle" });
    }
  },
  // Six insistent square-wave beeps over ~3s — cuts through a Friday
  // rush; deliberately annoying, that's the job.
  alarm(ac) {
    for (let i = 0; i < 6; i += 1) {
      tone(ac, {
        freq: i % 2 === 0 ? 1244.5 : 932.3,
        at: i * 0.5,
        dur: 0.34,
        gain: 0.5,
        type: "square",
      });
    }
  },
};

const bufferCache = new Map<string, Promise<AudioBuffer>>();
let activeFileSource: AudioBufferSourceNode | null = null;

function playFile(ac: AudioContext, url: string): void {
  let buf = bufferCache.get(url);
  if (!buf) {
    buf = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b));
    bufferCache.set(url, buf);
  }
  void buf
    .then((buffer) => {
      try {
        activeFileSource?.stop();
      } catch {
        // Already ended.
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const g = ac.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(ac.destination);
      src.start();
      src.stop(ac.currentTime + Math.min(buffer.duration, FILE_MAX_SECONDS));
      activeFileSource = src;
    })
    .catch(() => {
      // Fetch/decode failed (offline before first play) — fall back to a
      // sound that needs no network.
      PLAYERS.bell(ac);
    });
}

function play(id: SoundId): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const file = SOUND_FILES[id];
    if (file) playFile(ctx, file);
    else PLAYERS[id as keyof typeof PLAYERS](ctx);
  } catch {
    // No audio available — silently skip; the visual board still updates.
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function NewOrderChime({ openCount }: { openCount: number }): React.ReactElement {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true);
  const sound = useSyncExternalStore(subscribe, readSound, () => "bell" as SoundId);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (prev.current !== null && openCount > prev.current && readEnabled()) play(readSound());
    prev.current = openCount;
  }, [openCount]);

  return (
    <div className="flex items-center gap-1.5">
      {enabled ? (
        <select
          aria-label="New-order sound"
          value={sound}
          onChange={(e) => {
            const next = e.target.value as SoundId;
            setSound(next);
            // Preview = the autoplay-unlocking gesture + staff hear what
            // they picked at real volume.
            play(next);
          }}
          className="h-9 rounded-full border border-current/30 bg-transparent px-2.5 text-xs opacity-80 transition hover:opacity-100 [&>option]:text-black"
        >
          {SOUND_IDS.map((id) => (
            <option key={id} value={id}>
              {SOUND_LABELS[id]}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        aria-pressed={enabled}
        aria-label={enabled ? "Turn new-order sound off" : "Turn new-order sound on"}
        title={enabled ? "New-order sound: on" : "New-order sound: off"}
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          if (next) play(readSound());
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-current/30 text-base opacity-80 transition hover:opacity-100"
      >
        {enabled ? "🔔" : "🔕"}
      </button>
    </div>
  );
}
