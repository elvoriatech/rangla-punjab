import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "./auth";
import type { StaffPasswordError } from "./staff";
import { changeStaffPassword, STAFF_PASSWORD_MIN_LENGTH } from "./staff";
import { PrimaryButton } from "./components";
import { fill, useI18n } from "./i18n";
import { colors, fonts, radius } from "./theme";
import { SHEET_MAX } from "./layout";

/**
 * "Change my password", from behind the counter.
 *
 * Three boxes, because the CURRENT password is required: the restaurant's
 * phone spends service on the pass where anyone can pick it up, and a
 * two-box form would let whoever picks it up lock the owner out.
 *
 * A success is loud on purpose — a green line in the sheet AND a system
 * alert — because the thing it has to communicate is not "saved" but
 * "every OTHER device is now signed out". This one is not: the server
 * hands back a re-issued token (the credential is a signed session value,
 * and the change invalidated the old one), which `replaceStaffToken`
 * swaps into the secure store before the sheet closes.
 *
 * Built as a hand-rolled sheet like `owner-menu.tsx` and `issue-sheet.tsx`
 * — transparent `<Modal>`, dimmed tap-away backdrop, a panel that swallows
 * its own touches. Nothing is positioned left or right, so an Arabic
 * build mirrors for free.
 */

export function PasswordSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff, replaceStaffToken } = useAuth();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Which box the answer belongs under, when the server named one. */
  const [badBox, setBadBox] = useState<"current" | "next" | "confirm" | null>(null);
  const [minLength, setMinLength] = useState(STAFF_PASSWORD_MIN_LENGTH);

  // Every open starts empty: a half-typed password left in a box is the
  // last thing that should survive the sheet being dismissed.
  useEffect(() => {
    if (visible) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setDone(null);
    setBadBox(null);
    setBusy(false);
  }, [visible]);

  const filled = current.length > 0 && next.length > 0 && confirm.length > 0;
  const matches = next === confirm;
  const canSave = filled && matches && !busy;

  const message = useCallback(
    (error: StaffPasswordError): { text: string; box: "current" | "next" | "confirm" | null } => {
      switch (error) {
        case "wrong_password":
          return { text: t.passwordWrong, box: "current" };
        case "mismatch":
          return { text: t.passwordMismatch, box: "confirm" };
        case "too_short":
          return { text: fill(t.passwordTooShort, { count: minLength }), box: "next" };
        case "same_as_current":
          return { text: t.passwordSame, box: "next" };
        case "rate_limited":
          return { text: t.passwordRateLimited, box: null };
        case "network":
          return { text: t.staffLoadFailed, box: null };
        default:
          return { text: t.passwordFailed, box: null };
      }
    },
    [t, minLength],
  );

  const save = useCallback(async (): Promise<void> => {
    if (!staffToken || !canSave) return;
    setBusy(true);
    setError(null);
    setBadBox(null);

    const res = await changeStaffPassword(staffToken, current, next, confirm);
    setBusy(false);

    if (!res.ok) {
      if (res.minLength) setMinLength(res.minLength);
      // "unauthorized" is the session dying under us — not a password
      // problem, and the app's one response to it is to sign out.
      if (res.error === "unauthorized") {
        clearStaff();
        onClose();
        return;
      }
      const { text, box } = message(res.error);
      setError(text);
      setBadBox(box);
      return;
    }

    // Adopt the re-issued credential BEFORE anything closes: the old one
    // is already dead server-side.
    await replaceStaffToken(res.token);
    setDone(t.passwordChanged);
    Alert.alert(t.passwordChangedTitle, t.passwordChanged, [{ text: t.close, onPress: onClose }]);
  }, [
    staffToken,
    canSave,
    current,
    next,
    confirm,
    clearStaff,
    replaceStaffToken,
    message,
    onClose,
    t,
  ]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.lift}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>{t.passwordTitle}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
            >
              <Text style={styles.hint}>{t.passwordHint}</Text>

              {/* Announced as well as shown. A live region that only
                  exists once there is something in it is announced
                  unreliably, so both lines keep their slot. */}
              <View accessibilityLiveRegion="polite">
                {done ? <Text style={styles.ok}>{done}</Text> : null}
                {error ? <Text style={styles.bad}>{error}</Text> : null}
              </View>

              <Field
                label={t.passwordCurrent}
                value={current}
                onChange={(v) => {
                  setCurrent(v);
                  setError(null);
                  setBadBox(null);
                }}
                bad={badBox === "current"}
                autoComplete="current-password"
                textContentType="password"
              />

              <Field
                label={t.passwordNew}
                value={next}
                onChange={(v) => {
                  setNext(v);
                  setError(null);
                  setBadBox(null);
                }}
                bad={badBox === "next"}
                autoComplete="new-password"
                textContentType="newPassword"
                hint={fill(t.passwordMinHint, { count: minLength })}
              />

              <Field
                label={t.passwordConfirm}
                value={confirm}
                onChange={(v) => {
                  setConfirm(v);
                  setError(null);
                  setBadBox(null);
                }}
                // Shown while typing, before any round trip: the two boxes
                // disagreeing is something the app can see for itself.
                bad={badBox === "confirm" || (confirm.length > 0 && !matches)}
                autoComplete="new-password"
                textContentType="newPassword"
                hint={confirm.length > 0 && !matches ? t.passwordMismatch : undefined}
              />

              <PrimaryButton
                label={t.passwordSave}
                busyLabel={t.passwordSaving}
                busy={busy}
                disabled={!canSave}
                onPress={() => void save()}
              />
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  bad,
  hint,
  autoComplete,
  textContentType,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  bad?: boolean;
  hint?: string;
  autoComplete: "current-password" | "new-password";
  textContentType: "password" | "newPassword";
}): React.ReactElement {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoComplete={autoComplete}
        textContentType={textContentType}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={1024}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, bad && styles.inputBad]}
        accessibilityLabel={label}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
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
    gap: 8,
    // A short form on a tall glass: cap it so a tablet doesn't stretch
    // three inputs across the whole screen.
    width: "100%",
    maxWidth: SHEET_MAX,
    alignSelf: "center",
    maxHeight: "88%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  title: { color: colors.ink, ...fonts.display, fontSize: 22 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  ok: { color: colors.positive, ...fonts.bodySemi, fontSize: 13 },
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
});
