import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import type { StaffTeamError, StaffTeamMember } from "../staff";
import {
  addStaffTeamMember,
  fetchStaffTeam,
  removeStaffTeamMember,
  setStaffTeamPassword,
  TEAM_PASSWORD_MIN,
  updateStaffTeamMember,
} from "../staff";
import { BrandHeader, PasswordInput, PrimaryButton } from "../components";
import { fill, useI18n } from "../i18n";
import { SHEET_MAX, useLayout } from "../layout";
import { colors, fonts, radius } from "../theme";

/**
 * The owner's Team page, in the app (owner only — the owner menu hides the
 * row from everyone else and the server answers them 403).
 *
 * A list of who can sign in — the owner first, with "Everything" — and a
 * sheet to add a person or change one: name, the email that is their
 * login, a password the OWNER sets and hands over, and the boxes they may
 * open. Same rules as the dashboard (`team-service.ts`): no invitation
 * mail, a new password signs the person out everywhere, removing them
 * ends their login on every device.
 */

/** Same two starting points as the dashboard's Team page. */
const PRESETS: Record<"manager" | "staff", readonly string[]> = {
  manager: [
    "overview",
    "orders",
    "cancel",
    "reservations",
    "catering",
    "kitchen",
    "qr",
    "menu",
    "giftcards",
    "appearance",
    "reports",
  ],
  staff: ["overview", "orders", "reservations", "kitchen", "qr"],
};

type Draft = { mode: "add" } | { mode: "edit"; member: StaffTeamMember };

export function TeamScreen({
  onBack,
  onOpenOwnerMenu,
}: {
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const [members, setMembers] = useState<StaffTeamMember[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const areaLabels = t.teamAreaLabels as Record<string, string>;

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffTeam(staffToken);
    setLoaded(true);
    if (res.ok) {
      setMembers(res.data.members);
      setAreas(res.data.areas);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    else setFailed(true);
  }, [staffToken, clearStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const staff = members.filter((m) => !m.isOwner);
  const owners = members.filter((m) => m.isOwner);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.teamTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 32,
          gap: 12,
          ...layout.content,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.red}
          />
        }
      >
        <Text style={styles.intro}>{t.teamIntro}</Text>
        {failed ? <Text style={styles.failed}>{t.staffLoadFailed}</Text> : null}

        {!loaded ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : (
          <>
            {owners.map((m) => (
              <View key={m.id} style={styles.card}>
                <View style={styles.topRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {m.name ?? m.email}
                  </Text>
                  <View style={[styles.pill, styles.pillOwner]}>
                    <Text style={[styles.pillText, styles.pillTextOwner]}>{t.teamOwner}</Text>
                  </View>
                </View>
                {m.name ? <Text style={styles.email}>{m.email}</Text> : null}
                <Text style={styles.areasLine}>{t.teamAllAreas}</Text>
              </View>
            ))}

            {staff.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={34} color={colors.inkSoft} />
                <Text style={styles.emptyTitle}>{t.teamEmpty}</Text>
              </View>
            ) : (
              staff.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setDraft({ mode: "edit", member: m })}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.teamEdit} ${m.name ?? m.email}`}
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.topRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.name ?? m.email}
                    </Text>
                    <Ionicons name="create-outline" size={18} color={colors.inkSoft} />
                  </View>
                  {m.name ? <Text style={styles.email}>{m.email}</Text> : null}
                  <Text style={styles.areasLine}>
                    {m.permissions.length > 0
                      ? m.permissions.map((p) => areaLabels[p] ?? p).join(" · ")
                      : "—"}
                  </Text>
                </Pressable>
              ))
            )}

            <PrimaryButton label={t.teamAdd} onPress={() => setDraft({ mode: "add" })} />
          </>
        )}
      </ScrollView>

      <MemberSheet
        draft={draft}
        areas={areas}
        onClose={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          void load();
        }}
      />
    </View>
  );
}

/** One person: add (name, email, password, areas) or edit (name, areas,
 *  an optional new password, remove). */
function MemberSheet({
  draft,
  areas,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  areas: string[];
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const member = draft?.mode === "edit" ? draft.member : null;
  const areaLabels = t.teamAreaLabels as Record<string, string>;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Every open starts from the person (or empty), never from what the
  // last sheet left behind — least of all a typed password.
  useEffect(() => {
    if (!draft) return;
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setPassword("");
    setTicked(member ? [...member.permissions] : [...PRESETS.staff]);
    setBusy(false);
    setError(null);
    setNotice(null);
    setConfirmRemove(false);
  }, [draft, member]);

  const message = (e: StaffTeamError): string => {
    if (e === "invalid_email") return t.teamErrEmail;
    if (e === "email_taken") return t.teamErrTaken;
    if (e === "weak_password") return t.teamErrWeak;
    if (e === "invalid_name") return t.teamErrName;
    if (e === "network") return t.staffLoadFailed;
    return t.teamErrFailed;
  };

  const toggle = (area: string): void => {
    setTicked((list) => (list.includes(area) ? list.filter((a) => a !== area) : [...list, area]));
    setError(null);
  };

  async function run(
    action: () => Promise<{ ok: true } | { ok: false; error: StaffTeamError }>,
    done: () => void,
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await action();
    setBusy(false);
    if (res.ok) {
      done();
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      onClose();
      return;
    }
    setError(message(res.error));
  }

  const save = (): void => {
    if (!staffToken) return;
    if (name.trim().length === 0) {
      setError(t.teamErrName);
      return;
    }
    // Keep the boxes in the server's own order, whatever order they were ticked.
    const permissions = areas.filter((a) => ticked.includes(a));
    if (member) {
      void run(
        () => updateStaffTeamMember(staffToken, member.id, { name: name.trim(), permissions }),
        onSaved,
      );
      return;
    }
    if (password.length < TEAM_PASSWORD_MIN) {
      setError(t.teamErrWeak);
      return;
    }
    void run(
      () =>
        addStaffTeamMember(staffToken, {
          name: name.trim(),
          email: email.trim(),
          password,
          permissions,
        }),
      onSaved,
    );
  };

  const setNewPassword = (): void => {
    if (!staffToken || !member) return;
    if (password.length < TEAM_PASSWORD_MIN) {
      setError(t.teamErrWeak);
      return;
    }
    void run(
      () => setStaffTeamPassword(staffToken, member.id, password),
      () => {
        setPassword("");
        setNotice(t.teamPasswordSet);
      },
    );
  };

  const remove = (): void => {
    if (!staffToken || !member) return;
    void run(() => removeStaffTeamMember(staffToken, member.id), onSaved);
  };

  return (
    <Modal visible={draft !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.lift}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {member ? (member.name ?? member.email) : t.teamAdd}
              </Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
            >
              <View accessibilityLiveRegion="polite">
                {notice ? <Text style={styles.ok}>{notice}</Text> : null}
                {error ? <Text style={styles.bad}>{error}</Text> : null}
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.label}>{t.teamName}</Text>
                <TextInput
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    setError(null);
                  }}
                  maxLength={60}
                  autoCapitalize="words"
                  style={styles.input}
                  accessibilityLabel={t.teamName}
                />
              </View>

              {member ? (
                <Text style={styles.email}>{member.email}</Text>
              ) : (
                <View style={{ gap: 4 }}>
                  <Text style={styles.label}>{t.teamEmail}</Text>
                  <TextInput
                    value={email}
                    onChangeText={(v) => {
                      setEmail(v);
                      setError(null);
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    maxLength={254}
                    style={styles.input}
                    accessibilityLabel={t.teamEmail}
                  />
                </View>
              )}

              <View style={{ gap: 4 }}>
                <Text style={styles.label}>{member ? t.teamNewPassword : t.teamPassword}</Text>
                <PasswordInput
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setError(null);
                  }}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={1024}
                  style={styles.input}
                  accessibilityLabel={member ? t.teamNewPassword : t.teamPassword}
                />
                <Text style={styles.hint}>{t.teamPasswordHint}</Text>
                {member ? (
                  <Pressable
                    onPress={setNewPassword}
                    disabled={busy || password.length === 0}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.smallBtn,
                      (pressed || busy || password.length === 0) && { opacity: 0.5 },
                    ]}
                  >
                    <Ionicons name="key-outline" size={16} color={colors.red} />
                    <Text style={styles.smallBtnText}>{t.teamNewPassword}</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={{ gap: 8 }}>
                <View style={styles.areasHeader}>
                  <Text style={styles.label}>{t.teamAreas}</Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {(["manager", "staff"] as const).map((preset) => (
                      <Pressable
                        key={preset}
                        onPress={() => {
                          setTicked([...PRESETS[preset]]);
                          setError(null);
                        }}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.preset, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.presetText}>
                          {preset === "manager" ? t.teamPresetManager : t.teamPresetStaff}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                {areas.map((area) => {
                  const on = ticked.includes(area);
                  return (
                    <Pressable
                      key={area}
                      onPress={() => toggle(area)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={areaLabels[area] ?? area}
                      style={({ pressed }) => [styles.areaRow, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons
                        name={on ? "checkbox" : "square-outline"}
                        size={22}
                        color={on ? colors.red : colors.inkSoft}
                      />
                      <Text style={styles.areaText}>{areaLabels[area] ?? area}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <PrimaryButton
                label={member ? t.teamSave : t.teamCreate}
                busy={busy}
                onPress={save}
              />

              {member ? (
                confirmRemove ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.confirmText}>
                      {fill(t.teamRemoveConfirm, { name: member.name ?? member.email })}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <Pressable
                        onPress={() => setConfirmRemove(false)}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.confirmBtnText}>{t.signInCancel}</Text>
                      </Pressable>
                      <Pressable
                        onPress={remove}
                        disabled={busy}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.confirmBtn,
                          styles.confirmBtnDanger,
                          (pressed || busy) && { opacity: 0.7 },
                        ]}
                      >
                        <Text style={[styles.confirmBtnText, { color: "#fff" }]}>
                          {t.teamRemove}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setConfirmRemove(true)}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeLink, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={styles.removeText}>{t.teamRemove}</Text>
                  </Pressable>
                )
              ) : null}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.inkSoft, ...fonts.body, fontSize: 13, lineHeight: 18 },
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { color: colors.ink, fontSize: 15.5, ...fonts.bodyBold, textAlign: "center" },
  card: {
    gap: 4,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, color: colors.ink, ...fonts.bodyBold, fontSize: 15.5 },
  email: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  areasLine: { color: colors.ink, ...fonts.bodySemi, fontSize: 12.5, lineHeight: 17 },
  pill: { borderRadius: radius.pill, borderWidth: 1, paddingVertical: 3, paddingHorizontal: 9 },
  pillText: { fontSize: 11.5, ...fonts.bodyBold },
  pillOwner: { backgroundColor: "#fdf4dc", borderColor: colors.gold },
  pillTextOwner: { color: "#7a5a00" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  lift: { width: "100%" },
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
    maxHeight: "92%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sheetTitle: { flex: 1, color: colors.ink, ...fonts.display, fontSize: 22 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
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
  smallBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 2,
  },
  smallBtnText: { color: colors.red, ...fonts.bodyBold, fontSize: 13 },
  areasHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  preset: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.creamCard,
  },
  presetText: { color: colors.ink, ...fonts.bodySemi, fontSize: 12 },
  areaRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36 },
  areaText: { color: colors.ink, ...fonts.bodySemi, fontSize: 14.5 },
  removeLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  removeText: { color: colors.danger, ...fonts.bodyBold, fontSize: 14 },
  confirmBox: {
    gap: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.lg,
    padding: 12,
    backgroundColor: "#fdeee6",
  },
  confirmText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13.5, lineHeight: 19 },
  confirmBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.creamCard,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  confirmBtnText: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
});
