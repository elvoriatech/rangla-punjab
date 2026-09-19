import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerStaffDevice, unregisterStaffDevice } from "./staff";

/**
 * Push notifications for the RESTAURANT's phone (P7-11).
 *
 * Only the counter is ever pushed to: a guest device holds receipts, not
 * a shift. So everything here is gated on a staff session — no permission
 * prompt, no token, no registration for a guest, and the whole module is
 * inert until someone signs in as the restaurant.
 *
 * Transport is the **Expo Push API**: the device hands our server an
 * `ExponentPushToken[…]`, the server posts to `exp.host`, and Expo talks
 * to APNs/FCM. That is why there is no Firebase SDK in this app.
 *
 * ⛔ The credentials that make a token DELIVERABLE are human-gated and
 * deliberately absent: the APNs key has to be uploaded to EAS
 * (`eas credentials`) and Android needs the FCM service-account JSON (see
 * BUILDS.md). Until then this code runs end to end and registers a token
 * that simply never receives anything — which is the intended degraded
 * state, not a failure.
 *
 * House posture, as everywhere else in this app: nothing throws. A
 * simulator, a denied permission, Expo Go, an offline device, a server
 * that predates the route — every one of them is "no push", never an
 * error the owner has to read.
 */

/** Android notification channel. Orders are the reason the phone is in
 *  someone's pocket during service, so it gets sound and a high
 *  importance rather than the silent default. */
const CHANNEL_ID = "orders";

/** What a push is ABOUT — the only part of the payload the app acts on.
 *  Everything else (title, body) is the server's to write. */
export type PushTarget =
  { kind: "order"; orderId: string | null } | { kind: "issue"; issueId: string | null };

/**
 * Reads `data` off a notification the same way `asStaffOrder` reads an
 * order: defensively, and with "I don't know this kind" meaning "ignore
 * it" rather than "crash". A `kind` this build has never heard of is not
 * a target — the notification still shows, tapping it just opens the app.
 */
export function asPushTarget(raw: unknown): PushTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const kind = typeof data.kind === "string" ? data.kind : "";
  const id = (key: string): string | null => {
    const value = data[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  if (kind === "order") return { kind: "order", orderId: id("orderId") };
  if (kind === "issue") return { kind: "issue", issueId: id("issueId") };
  return null;
}

/** `ios` / `android` / `web` — the three the server's zod accepts. */
function platformName(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

/**
 * The EAS project the push token is attributed to.
 *
 * Lives in `app.json` under `extra.eas.projectId` and survives the
 * `app.config.js` merge (`extra` is spread, so the generated brand block
 * only replaces `extra.brand`). Null means this build has no project id
 * — `registerForStaffPush` then does nothing at all rather than asking
 * for a permission it could not use.
 */
export function pushProjectId(): string | null {
  const eas = Constants.expoConfig?.extra?.eas as unknown;
  if (!eas || typeof eas !== "object") return null;
  const id = (eas as Record<string, unknown>).projectId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** The build's own version, for the server's `appVersion` column — it is
 *  what tells an owner "this phone is three releases behind". */
function appVersion(): string | undefined {
  const version = Constants.expoConfig?.version;
  return typeof version === "string" && version ? version : undefined;
}

/**
 * The Expo token this device last registered, so signing out can hand the
 * server the exact string to delete without asking Expo for it again (and
 * so a re-mount doesn't re-POST the same row every 30 seconds).
 */
let lastToken: string | null = null;

/** True once the foreground presentation handler is installed. Setting it
 *  is global and idempotent, but doing it twice is pointless. */
let handlerSet = false;

function ensureHandler(): void {
  if (handlerSet) return;
  handlerSet = true;
  // A new order that arrives while the owner is looking at the app should
  // still be visible — the board is one tab away, not necessarily open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask ONCE, and only at the moment the answer can be used (i.e. a staff
 *  session exists). Returns false for "not allowed", including the
 *  already-denied case, which must never re-prompt. */
async function ensurePermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false) return false;
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * Register this device for the restaurant's pushes.
 *
 * Returns the Expo token on success and null for every "no push here"
 * case — a simulator, web, a missing project id, a refused permission,
 * Expo Go without a development build, no network, or a server that has
 * no `/api/v1/staff/devices` yet.
 *
 * `channelName` is the Android channel's user-visible name (it shows in
 * the system notification settings), passed in translated from the shell.
 */
export async function registerForStaffPush(
  staffToken: string | null,
  opts: { channelName?: string } = {},
): Promise<string | null> {
  if (!staffToken) return null;
  // A simulator can hold a permission but never a push token — asking
  // would only put a dialog in front of a developer.
  if (!Device.isDevice) return null;
  if (Platform.OS === "web") return null;
  const projectId = pushProjectId();
  if (!projectId) return null;

  ensureHandler();

  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: opts.channelName ?? "Orders",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
        showBadge: true,
      });
    } catch {
      /* A channel we couldn't create just means the OS default is used. */
    }
  }

  if (!(await ensurePermission())) return null;

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch {
    // Offline, Expo Go on a platform that no longer mints tokens there,
    // or the push service being unreachable. The next app start retries.
    return null;
  }
  if (!token) return null;

  const res = await registerStaffDevice(staffToken, {
    token,
    platform: platformName(),
    appVersion: appVersion(),
  });
  // Remember it even when the POST failed: the token is still THIS
  // device's, and sign-out should try to delete it either way.
  lastToken = token;
  return res.ok ? token : null;
}

/**
 * Tell the server to stop pushing to this device. Best effort by design —
 * the session is being torn down whatever the server says, exactly like
 * `staffLogout`.
 */
export async function unregisterStaffPush(staffToken: string | null): Promise<void> {
  if (!staffToken) return;
  const token = lastToken;
  lastToken = null;
  if (!token) return;
  await unregisterStaffDevice(staffToken, token);
}

/**
 * The app's side of a push: where a tap should land, and what a push that
 * arrives while the app is open should refresh.
 *
 * Three arrivals, all of them handled:
 *  - a tap while the app is running (`addNotificationResponseReceivedListener`);
 *  - a tap that COLD-STARTS the app, which fired before any listener
 *    existed — `getLastNotificationResponse` is what recovers it;
 *  - a push received with the app in the foreground, which is not a
 *    navigation at all, just a reason to re-read the board.
 *
 * Every response is acted on once: the last-response value survives
 * re-renders, so it is cleared after use.
 */
export function usePushRouting({
  enabled,
  onTarget,
  onReceived,
}: {
  /** Restaurant mode. False for a guest device, where none of this exists. */
  enabled: boolean;
  onTarget: (target: PushTarget) => void;
  onReceived: () => void;
}): void {
  // Kept in refs so a new callback identity doesn't tear the native
  // subscriptions down and rebuild them on every render of the shell.
  const targetRef = useRef(onTarget);
  targetRef.current = onTarget;
  const receivedRef = useRef(onReceived);
  receivedRef.current = onReceived;

  useEffect(() => {
    if (!enabled) return;
    ensureHandler();

    const handle = (data: unknown): void => {
      const target = asPushTarget(data);
      if (target) targetRef.current(target);
    };

    // The tap that opened the app, before any of this was listening.
    try {
      const cold = Notifications.getLastNotificationResponse();
      if (cold) {
        handle(cold.notification.request.content.data);
        Notifications.clearLastNotificationResponse();
      }
    } catch {
      /* No native module (Expo Go on some platforms) — nothing to route. */
    }

    let tapped: { remove: () => void } | null = null;
    let received: { remove: () => void } | null = null;
    try {
      tapped = Notifications.addNotificationResponseReceivedListener((response) => {
        handle(response.notification.request.content.data);
      });
      received = Notifications.addNotificationReceivedListener(() => {
        receivedRef.current();
      });
    } catch {
      /* Same: no listeners is the degraded state, not a crash. */
    }
    return () => {
      tapped?.remove();
      received?.remove();
    };
  }, [enabled]);
}
