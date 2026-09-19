import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * The new-order chime — the audible half of the board's "something
 * landed" signal, beside the gold highlight and the buzz.
 *
 * Why a bundled file rather than a synthesized tone: the pass is often a
 * tablet on a wall bracket with no network worth trusting mid-service,
 * and React Native has no WebAudio to synthesize with the way the
 * kitchen-display page does. One 18 KB asset ships in the binary and
 * plays offline.
 *
 * Nothing here ever throws. A device with the audio route taken by a
 * phone call, a build where the native module is missing (Expo Go on a
 * platform that lacks it), a player that never finished loading — each
 * is a chime that does not sound, which must never be a chime that
 * breaks the board.
 */

const ENABLED_KEY = "rangla-new-order-sound";

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
export function loadChime(): Chime {
  let player: AudioPlayer;
  try {
    player = createAudioPlayer(require("../assets/sounds/new-order.mp3"));
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
