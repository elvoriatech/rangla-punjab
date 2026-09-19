import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Where the device's bearer tokens live.
 *
 * Two separate slots, never mixed:
 *
 *  - `rangla-customer-token` — the guest's account token.
 *  - `rangla-staff-token`    — the restaurant's staff token. It unlocks the
 *    live orders board (other people's names, phone numbers and addresses),
 *    so it gets its own key: a guest sign-out must never leave it behind,
 *    and a staff sign-out must never be satisfied by clearing the guest's.
 *
 * Both are bearer credentials, so they belong in the platform keystore
 * (Keychain on iOS, EncryptedSharedPreferences on Android), not in
 * AsyncStorage's plain-text SQLite row. Builds before this change stored
 * the customer token in AsyncStorage under the same key; the first read
 * migrates that value across and deletes the old copy.
 *
 * SecureStore has no web implementation, and can fail on a device with no
 * screen lock or a broken keystore — every path falls back to AsyncStorage
 * rather than logging the user out.
 */

const KEY = "rangla-customer-token";
const STAFF_KEY = "rangla-staff-token";

let secureOk: boolean | null = null;

async function secureAvailable(): Promise<boolean> {
  if (secureOk !== null) return secureOk;
  try {
    secureOk = await SecureStore.isAvailableAsync();
  } catch {
    secureOk = false;
  }
  return secureOk;
}

/** @param migrate read (and retire) a pre-SecureStore AsyncStorage copy. */
async function read(key: string, migrate: boolean): Promise<string | null> {
  if (await secureAvailable()) {
    try {
      const secure = await SecureStore.getItemAsync(key);
      if (secure) return secure;
      if (migrate) {
        // One-shot migration from the pre-SecureStore builds.
        const legacy = await AsyncStorage.getItem(key);
        if (legacy) {
          await SecureStore.setItemAsync(key, legacy);
          await AsyncStorage.removeItem(key);
          return legacy;
        }
      }
      return null;
    } catch {
      /* fall through to AsyncStorage */
    }
  }
  return AsyncStorage.getItem(key).catch(() => null);
}

async function write(key: string, token: string): Promise<void> {
  if (await secureAvailable()) {
    try {
      await SecureStore.setItemAsync(key, token);
      await AsyncStorage.removeItem(key).catch(() => {});
      return;
    } catch {
      /* fall through */
    }
  }
  await AsyncStorage.setItem(key, token).catch(() => {});
}

async function clear(key: string): Promise<void> {
  if (await secureAvailable()) {
    await SecureStore.deleteItemAsync(key).catch(() => {});
  }
  await AsyncStorage.removeItem(key).catch(() => {});
}

export async function readToken(): Promise<string | null> {
  return read(KEY, true);
}

export async function writeToken(token: string): Promise<void> {
  return write(KEY, token);
}

export async function clearToken(): Promise<void> {
  return clear(KEY);
}

/* ── Staff ──────────────────────────────────────────────────────────────
 * The restaurant's own session. No legacy migration: the key is new. */

export async function readStaffToken(): Promise<string | null> {
  return read(STAFF_KEY, false);
}

export async function writeStaffToken(token: string): Promise<void> {
  return write(STAFF_KEY, token);
}

export async function clearStaffToken(): Promise<void> {
  return clear(STAFF_KEY);
}
