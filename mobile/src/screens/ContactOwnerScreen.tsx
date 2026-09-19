import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../auth";
import type { StaffContact, StaffContactField } from "../staff";
import {
  CONTACT_FIELDS,
  fetchStaffContact,
  isStaffContactField,
  updateStaffContact,
} from "../staff";
import { BrandHeader, OutlineButton, PrimaryButton } from "../components";
import { fill, useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, radius } from "../theme";

/**
 * Contact details, from behind the counter.
 *
 * Three numbers — landline, mobile, WhatsApp — each of which a guest
 * taps on their Account screen to call or to message. Any of them may be
 * left empty, and empty is not a gap to apologise for: it simply means
 * that row does not appear.
 *
 * The app validates NOTHING about a phone number. "0 7531 123456",
 * "+49 7531 123456" and "07531/123456" are the same number to an owner,
 * and deciding which of them is real is the server's job (it answers
 * with the E.164 form it stored, which is what goes back into the
 * inputs). All this screen does is put a 400's `field` under the input
 * that caused it.
 */

/** What the last save did, said once above the card. */
interface Notice {
  tone: "ok" | "bad";
  text: string;
}

export function ContactOwnerScreen({
  onBack,
  onOpenOwnerMenu,
}: {
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();

  const [loaded, setLoaded] = useState(false);
  const [contact, setContact] = useState<StaffContact | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Which input the server refused, if it named one. */
  const [badField, setBadField] = useState<StaffContactField | null>(null);
  const [busy, setBusy] = useState(false);

  const [landline, setLandline] = useState("");
  const [mobile, setMobile] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  /** Memoised so `save` below is not rebuilt on every keystroke. */
  const label = useMemo<Record<StaffContactField, string>>(
    () => ({
      landline: t.contactOwnerLandline,
      mobile: t.contactOwnerMobile,
      whatsapp: t.contactOwnerWhatsapp,
    }),
    [t],
  );

  /** The server's answer becomes the screen: the inputs follow what was
   *  actually stored, so "0 7531 …" visibly becomes "+49 7531 …" and a
   *  rejected edit never lingers. */
  const adopt = useCallback((next: StaffContact): void => {
    setContact(next);
    setLandline(next.landline ?? "");
    setMobile(next.mobile ?? "");
    setWhatsapp(next.whatsapp ?? "");
    setBadField(null);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffContact(staffToken);
    setLoaded(true);
    if (res.ok) {
      adopt(res.data);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    else setNotice({ tone: "bad", text: t.staffLoadFailed });
  }, [staffToken, clearStaff, adopt, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // All three travel together: this is one form with one button, and a
  // per-field PATCH would let the owner walk away from half an edit.
  const save = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    setBusy(true);
    setNotice(null);
    setBadField(null);
    const res = await updateStaffContact(staffToken, {
      landline: landline.trim(),
      mobile: mobile.trim(),
      whatsapp: whatsapp.trim(),
    });
    setBusy(false);
    if (res.ok) {
      adopt(res.data);
      setNotice({ tone: "ok", text: t.contactOwnerSaved });
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      return;
    }
    // The server names the number it refused — point at it, rather than
    // leaving the owner to guess which of the three was the problem.
    const field = isStaffContactField(res.field) ? res.field : null;
    setBadField(field);
    setNotice({
      tone: "bad",
      text:
        res.error === "invalid" && field
          ? fill(t.contactOwnerBad, { field: label[field] })
          : t.contactOwnerSaveFailed,
    });
  }, [staffToken, landline, mobile, whatsapp, adopt, clearStaff, t, label]);

  const value: Record<StaffContactField, string> = { landline, mobile, whatsapp };
  const setValue: Record<StaffContactField, (next: string) => void> = {
    landline: setLandline,
    mobile: setMobile,
    whatsapp: setWhatsapp,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.contactOwnerTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: layout.pad,
            paddingBottom: 40,
            gap: 14,
            ...layout.content,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {!loaded ? (
            <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
          ) : !contact ? (
            <>
              <Text style={styles.bad}>{t.staffLoadFailed}</Text>
              <OutlineButton label={t.issueRetry} onPress={() => void load()} />
            </>
          ) : (
            <>
              {notice ? (
                <Text style={notice.tone === "ok" ? styles.ok : styles.bad}>{notice.text}</Text>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.hint}>{t.contactOwnerHint}</Text>

                {CONTACT_FIELDS.map((field) => (
                  <View key={field} style={{ gap: 4 }}>
                    <Text style={styles.label}>{label[field]}</Text>
                    <TextInput
                      value={value[field]}
                      onChangeText={(next) => {
                        setValue[field](next);
                        setBadField(null);
                      }}
                      // A phone pad is the only keyboard that belongs on
                      // any of the three; `+` and spaces are fine, the
                      // server sorts the shape out.
                      keyboardType="phone-pad"
                      inputMode="tel"
                      autoComplete="tel"
                      textContentType="telephoneNumber"
                      autoCorrect={false}
                      spellCheck={false}
                      maxLength={32}
                      placeholder="+49 7531 123456"
                      placeholderTextColor={colors.inkSoft}
                      style={[styles.input, badField === field && styles.inputBad]}
                      accessibilityLabel={label[field]}
                    />
                  </View>
                ))}

                <Text style={styles.hint}>{t.contactOwnerNumberHint}</Text>

                <PrimaryButton
                  label={t.contactOwnerSave}
                  busyLabel={t.contactOwnerSaving}
                  busy={busy}
                  onPress={() => void save()}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  ok: { color: colors.positive, ...fonts.bodySemi, fontSize: 13 },
  bad: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
  },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  input: {
    backgroundColor: colors.cream,
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
