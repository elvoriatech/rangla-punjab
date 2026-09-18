import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Where the customer token lives.
 *
 * It is a bearer credential for this guest's account, so it belongs in the
 * platform keystore (Keychain on iOS, EncryptedSharedPreferences on
 * Android), not in AsyncStorage's plain-text SQLite row. Builds before
 * this change stored it in AsyncStorage under the same key; the first read
 * migrates that value across and deletes the old copy.
 *
 * SecureStore has no web implementation, and can fail on a device with no
 * screen lock or a broken keystore — every path falls back to AsyncStorage
 * rather than logging the guest out.
 */

const KEY = "rangla-customer-token";

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

export async function readToken(): Promise<string | null> {
  if (await secureAvailable()) {
    try {
      const secure = await SecureStore.getItemAsync(KEY);
      if (secure) return secure;
      // One-shot migration from the pre-SecureStore builds.
      const legacy = await AsyncStorage.getItem(KEY);
      if (legacy) {
        await SecureStore.setItemAsync(KEY, legacy);
        await AsyncStorage.removeItem(KEY);
        return legacy;
      }
      return null;
    } catch {
      /* fall through to AsyncStorage */
    }
  }
  return AsyncStorage.getItem(KEY).catch(() => null);
}

export async function writeToken(token: string): Promise<void> {
  if (await secureAvailable()) {
    try {
      await SecureStore.setItemAsync(KEY, token);
      await AsyncStorage.removeItem(KEY).catch(() => {});
      return;
    } catch {
      /* fall through */
    }
  }
  await AsyncStorage.setItem(KEY, token).catch(() => {});
}

export async function clearToken(): Promise<void> {
  if (await secureAvailable()) {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
  }
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
