import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * The new-order chime — the audible half of the board's "something
 * landed" signal, beside the gold highlight and the buzz.
 *
 * Why bundled files rather than a synthesized tone: the pass is often a
 * tablet on a wall bracket with no network worth trusting mid-service,
 * and React Native has no WebAudio to synthesize with the way the
 * kitchen-display page does. Four small assets ship in the binary and
 * play offline; which one, and how loud, is the pass's own choice.
 *
 * Nothing here ever throws. A device with the audio route taken by a
 * phone call, a build where the native module is missing (Expo Go on a
 * platform that lacks it), a player that never finished loading — each
 * is a chime that does not sound, which must never be a chime that
 * breaks the board.
 */

const ENABLED_KEY = "rangla-new-order-sound";
const CHOICE_KEY = "rangla-new-order-sound-choice";
const VOLUME_KEY = "rangla-new-order-sound-volume";

/**
 * The tones the pass can pick from (owner, 2026-10-07: "should be louder,
 * and let us choose"). All four are mastered loud — the original bell sat
 * at −16 dBFS average; these sit between −10 and −4 — and the bell comes
 * once or three times for a kitchen that does not hear the first ring.
 */
export const ORDER_SOUNDS = ["bell", "bell3", "dingdong", "alarm"] as const;
export type OrderSound = (typeof ORDER_SOUNDS)[number];

const SOUND_FILES: Record<OrderSound, number> = {
  bell: require("../assets/sounds/order-bell.m4a"),
  bell3: require("../assets/sounds/order-bell3.m4a"),
  dingdong: require("../assets/sounds/order-dingdong.m4a"),
  alarm: require("../assets/sounds/order-alarm.m4a"),
};

/** The three-ring bell is the default: loud, and long enough to hear
 *  over a kitchen. */
export const DEFAULT_ORDER_SOUND: OrderSound = "bell3";

/** Volume steps offered on the board, as fractions of the device volume. */
export const ORDER_VOLUMES = [0.25, 0.5, 0.75, 1] as const;

export async function getOrderSound(): Promise<OrderSound> {
  try {
    const v = await AsyncStorage.getItem(CHOICE_KEY);
    return (ORDER_SOUNDS as readonly string[]).includes(v ?? "")
      ? (v as OrderSound)
      : DEFAULT_ORDER_SOUND;
  } catch {
    return DEFAULT_ORDER_SOUND;
  }
}

export async function setOrderSound(choice: OrderSound): Promise<void> {
  try {
    await AsyncStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Honoured for this session even if it cannot be kept.
  }
}

/** 0–1, default full: the device's own volume is the ceiling anyway. */
export async function getOrderVolume(): Promise<number> {
  try {
    const v = Number(await AsyncStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

export async function setOrderVolume(volume: number): Promise<void> {
  try {
    await AsyncStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // Same as above.
  }
}

/** Default ON, unlike auto-print: a sound costs nothing and un-missing
 *  an order is the whole point of the board. Only an explicit "0"
 *  silences it, so a first run and an unreadable store both ring. */
export async function isNewOrderSoundOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function setNewOrderSoundOn(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    // A device that cannot persist the switch still honours it for this
    // session — the in-memory state is the board's, not ours.
  }
}

/**
 * A loaded player, ready to be re-triggered.
 *
 * Kept as ONE instance for the life of the board rather than created per
 * order: constructing a player decodes the file, which is far too slow
 * to sit between an order landing and the kitchen hearing about it.
 */
export type Chime = { play: () => void; release: () => void };

/** Silence, shaped like a chime — what a device that cannot play audio
 *  gets, so the caller never has to branch. */
const SILENT: Chime = { play: () => {}, release: () => {} };

/**
 * Load the chime and hand back something that can sound it.
 *
 * The audio MODE matters as much as the file. A pass tablet lives on
 * silent (nobody wants its keyboard clicking through service), so
 * `playsInSilentMode` is the difference between a chime and no chime at
 * all; `mixWithOthers` means the kitchen's radio keeps playing rather
 * than being ducked or stopped by a 1.5-second ding.
 */
export function loadChime(choice: OrderSound = DEFAULT_ORDER_SOUND, volume = 1): Chime {
  let player: AudioPlayer;
  try {
    player = createAudioPlayer(SOUND_FILES[choice] ?? SOUND_FILES[DEFAULT_ORDER_SOUND]);
    player.volume = Math.max(0, Math.min(1, volume));
  } catch {
    return SILENT;
  }
  // Fire-and-forget: the mode applies to the session, not to this
  // player, and a device that refuses it still plays through whatever
  // mode it already had.
  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
    shouldPlayInBackground: false,
    allowsRecording: false,
  }).catch(() => {});

  let gone = false;
  return {
    play: () => {
      if (gone) return;
      try {
        // Back to the top first: a second order inside 1.5 seconds must
        // ring again, and a player left at its end would simply sit
        // there. `seekTo` resolves after the seek, so `play()` is called
        // without waiting on it — a rewind that is still in flight is
        // started by the play that follows it.
        void player.seekTo(0).catch(() => {});
        player.play();
      } catch {
        // Audio focus lost, route gone, module missing — the board's
        // gold highlight is still doing its job.
      }
    },
    release: () => {
      if (gone) return;
      gone = true;
      try {
        player.remove();
      } catch {
        // Already torn down by the native side.
      }
    },
  };
}
