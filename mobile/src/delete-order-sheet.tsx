import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "./auth";
import { DELETE_REASON_MIN, deleteStaffOrder } from "./staff";
import { fill, useI18n } from "./i18n";
import { SHEET_MAX } from "./layout";
import { colors, fonts, radius } from "./theme";

/**
 * "Delete order #12" — the dashboard's delete for a cancelled order nobody
 * paid for, from the board (owner only; the board only offers it where
 * `canDeleteOrder` says the server will accept it).
 *
 * A sheet rather than a system alert because it needs a REASON: the order
 * number, total and reason stay in the deleted-orders log the reports
 * show, so "why did #12 disappear?" always has an answer. Built like
 * `password-sheet.tsx` — transparent modal, tap-away backdrop.
 */
export function DeleteOrderSheet({
  order,
  onClose,
  onDeleted,
}: {
  /** The order to delete, or null when the sheet is closed. */
  order: { id: string; orderNumber: number } | null;
  onClose: () => void;
  onDeleted: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (order) return;
    setReason("");
    setBusy(false);
    setError(null);
  }, [order]);

  const remove = async (): Promise<void> => {
    if (!staffToken || !order || busy) return;
    if (reason.trim().length < DELETE_REASON_MIN) {
      setError(t.boardDeleteReasonShort);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await deleteStaffOrder(staffToken, order.id, reason.trim());
    setBusy(false);
    if (res.ok) {
      onDeleted();
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      onClose();
      return;
    }
    setError(
      res.error === "conflict"
        ? t.boardDeleteBlocked
        : res.error === "invalid"
          ? t.boardDeleteReasonShort
          : res.error === "network"
            ? t.staffLoadFailed
            : t.boardActionFailed,
    );
  };

  return (
    <Modal visible={order !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.lift}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {fill(t.boardDeleteTitle, { number: order?.orderNumber ?? "" })}
              </Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>{t.boardDeleteHint}</Text>

            <View style={{ gap: 4 }}>
              <Text style={styles.label}>{t.boardDeleteReason}</Text>
              <TextInput
                value={reason}
                onChangeText={(v) => {
                  setReason(v);
                  setError(null);
                }}
                placeholder={t.boardDeleteReasonPlaceholder}
                placeholderTextColor={colors.inkSoft}
                maxLength={300}
                style={[styles.input, error ? styles.inputBad : null]}
                accessibilityLabel={t.boardDeleteReason}
              />
            </View>
            <View accessibilityLiveRegion="polite">
              {error ? <Text style={styles.bad}>{error}</Text> : null}
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.btnText}>{t.signInCancel}</Text>
              </Pressable>
              <Pressable
                onPress={() => void remove()}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnDanger,
                  (pressed || busy) && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.btnText, { color: "#fff" }]}>{t.boardDeleteConfirm}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  lift: { width: "100%" },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
    gap: 10,
    width: "100%",
    maxWidth: SHEET_MAX,
    alignSelf: "center",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { flex: 1, color: colors.ink, ...fonts.display, fontSize: 22 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  bad: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  input: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
    color: colors.ink,
    ...fonts.body,
    fontSize: 15,
  },
  inputBad: { borderColor: colors.danger },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.creamCard,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
});
