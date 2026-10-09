import { PermissionsAndroid, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/**
 * Bluetooth receipt printing (Android). The native half lives in
 * `android/…/BtPrinterModule.kt`; on iOS, web and in an older build without
 * the module this whole file answers "not available" and never throws.
 */

interface NativeBtPrinter {
  isAvailable(): boolean;
  isEnabled(): boolean;
  listPaired(): Promise<{ name: string; address: string }[]>;
  print(address: string, base64: string): Promise<boolean>;
}

const native =
  Platform.OS === "android" ? requireOptionalNativeModule<NativeBtPrinter>("BtPrinter") : null;

export interface PairedPrinter {
  name: string;
  address: string;
}

/** True on an Android build that carries the module and has Bluetooth. */
export function btPrintingAvailable(): boolean {
  try {
    return native?.isAvailable() === true;
  } catch {
    return false;
  }
}

export function btEnabled(): boolean {
  try {
    return native?.isEnabled() === true;
  } catch {
    return false;
  }
}

/** Android 12+ asks for "nearby devices" before any paired device can be
 *  read or connected to; older Android grants Bluetooth at install. */
export async function ensureBtPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (typeof Platform.Version === "number" && Platform.Version < 31) return true;
  try {
    const result = await PermissionsAndroid.request(
      "android.permission.BLUETOOTH_CONNECT" as never,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function listPairedPrinters(): Promise<PairedPrinter[]> {
  if (!native) return [];
  if (!(await ensureBtPermission())) return [];
  try {
    return await native.listPaired();
  } catch {
    return [];
  }
}

export type BtPrintError = "unavailable" | "permission" | "off" | "failed";

export async function btPrint(
  address: string,
  base64: string,
): Promise<{ ok: true } | { ok: false; error: BtPrintError }> {
  if (!native) return { ok: false, error: "unavailable" };
  if (!(await ensureBtPermission())) return { ok: false, error: "permission" };
  if (!btEnabled()) return { ok: false, error: "off" };
  try {
    await native.print(address, base64);
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "ERR_PERMISSION") return { ok: false, error: "permission" };
    if (code === "ERR_BLUETOOTH_OFF") return { ok: false, error: "off" };
    return { ok: false, error: "failed" };
  }
}
