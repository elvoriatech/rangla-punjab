import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { btEnabled, btPrint, listPairedPrinters, type PairedPrinter } from "../modules/bt-printer";
import type { BtPrinterChoice } from "./print";
import { setBtPrinter, testSlipBase64 } from "./print";
import { useI18n } from "./i18n";
import { SHEET_MAX } from "./layout";
import { colors, fonts, radius } from "./theme";

/**
 * Pick this device's Bluetooth receipt printer (Android). Lists the printers
 * already paired in Android's Bluetooth settings — no scanning, so no
 * location permission — plus the paper width and a test slip. Built like the
 * app's other sheets: tap-away backdrop, panel swallows its own touches.
 */
export function BtPrinterSheet({
  visible,
  current,
  onClose,
  onChanged,
}: {
  visible: boolean;
  current: BtPrinterChoice | null;
  onClose: () => void;
  onChanged: (next: BtPrinterChoice | null) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [devices, setDevices] = useState<PairedPrinter[] | null>(null);
  const [paper, setPaper] = useState<58 | 80>(current?.paper ?? 80);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setDevices(null);
    setNote(btEnabled() ? null : { ok: false, text: t.btPrinterOff });
    setDevices(await listPairedPrinters());
  }, [t]);

  useEffect(() => {
    if (!visible) return;
    setPaper(current?.paper ?? 80);
    void load();
  }, [visible, load, current]);

  const choose = (device: PairedPrinter): void => {
    const next = { name: device.name, address: device.address, paper };
    void setBtPrinter(next);
    onChanged(next);
    setNote(null);
  };

  const pickPaper = (p: 58 | 80): void => {
    setPaper(p);
    if (current) {
      const next = { ...current, paper: p };
      void setBtPrinter(next);
      onChanged(next);
    }
  };

  const test = async (): Promise<void> => {
    if (!current || busy) return;
    setBusy(true);
    const res = await btPrint(current.address, testSlipBase64());
    setBusy(false);
    setNote(
      res.ok
        ? { ok: true, text: t.btPrinterTestOk }
        : {
            ok: false,
            text:
              res.error === "off"
                ? t.btPrinterOff
                : res.error === "permission"
                  ? t.btPrinterPermission
                  : t.btPrinterFailed,
          },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{t.btPrinter}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 6 }}>
            <Text style={styles.hint}>{t.btPrinterHint}</Text>
            <Pressable
              onPress={() =>
                void Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS").catch(() => {})
              }
              accessibilityRole="button"
              style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="bluetooth" size={16} color={colors.red} />
              <Text style={styles.link}>{t.btPrinterOpenSettings}</Text>
            </Pressable>

            <View accessibilityLiveRegion="polite">
              {note ? <Text style={note.ok ? styles.ok : styles.bad}>{note.text}</Text> : null}
            </View>

            <Text style={styles.label}>{t.btPrinterPaired}</Text>
            {devices === null ? (
              <ActivityIndicator color={colors.red} />
            ) : devices.length === 0 ? (
              <Text style={styles.hint}>{t.btPrinterEmpty}</Text>
            ) : (
              devices.map((d) => {
                const on = current?.address === d.address;
                return (
                  <Pressable
                    key={d.address}
                    onPress={() => choose(d)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [
                      styles.device,
                      on && styles.deviceOn,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons
                      name={on ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={on ? colors.red : colors.inkSoft}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deviceName}>{d.name}</Text>
                      <Text style={styles.deviceAddr}>{d.address}</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
            <Pressable
              onPress={() => void load()}
              accessibilityRole="button"
              hitSlop={8}
              style={{ alignSelf: "flex-start" }}
            >
              <Text style={styles.link}>{t.btPrinterRefresh}</Text>
            </Pressable>

            <Text style={styles.label}>{t.btPrinterPaper}</Text>
            <View style={styles.chips}>
              {([58, 80] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => pickPaper(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: paper === p }}
                  style={[styles.chip, paper === p && styles.chipOn]}
                >
                  <Text style={[styles.chipText, paper === p && styles.chipTextOn]}>{p} mm</Text>
                </Pressable>
              ))}
            </View>

            {current ? (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <Pressable
                  onPress={() => void test()}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnMain,
                    (pressed || busy) && { opacity: 0.7 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onRed} />
                  ) : (
                    <Text style={styles.btnMainText}>{t.btPrinterTest}</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    void setBtPrinter(null);
                    onChanged(null);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.btnText}>{t.btPrinterRemove}</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
    gap: 8,
    width: "100%",
    maxWidth: SHEET_MAX,
    alignSelf: "center",
    maxHeight: "88%",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.ink, ...fonts.display, fontSize: 22, flex: 1 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  ok: { color: colors.positive, ...fonts.bodySemi, fontSize: 13 },
  bad: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  link: { color: colors.red, ...fonts.bodyBold, fontSize: 13, textDecorationLine: "underline" },
  device: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 12,
  },
  deviceOn: { borderColor: colors.red, borderWidth: 1.5 },
  deviceName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
  deviceAddr: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
  chips: { flexDirection: "row", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.creamCard,
    paddingVertical: 6,
    paddingHorizontal: 14,
    minHeight: 34,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13 },
  chipTextOn: { color: colors.onRed, ...fonts.bodyBold },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.creamCard,
    alignItems: "center",
    justifyContent: "center",
  },
  btnMain: { backgroundColor: colors.red, borderColor: colors.red },
  btnMainText: { color: colors.onRed, ...fonts.bodyBold, fontSize: 14 },
  btnText: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
});
