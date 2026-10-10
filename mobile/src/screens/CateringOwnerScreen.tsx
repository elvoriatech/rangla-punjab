import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import type { StaffCatering } from "../staff";
import { fetchStaffCatering, setStaffCateringStatus } from "../staff";
import { BrandHeader } from "../components";
import { localeTag, useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, radius } from "../theme";

/**
 * Catering enquiries, from behind the counter — the dashboard's Catering
 * page in the app, and the Reservations screen's twin: one card per
 * enquiry, grouped by event day, Confirm / Decline on the open ones and a
 * quiet "Change" once answered. A catering card carries more than a table
 * booking (where, an e-mail, the guest's message) and the time may still
 * be open, so it says so instead of inventing one.
 *
 * Reached from the owner's burger (with the open-enquiry badge) and from
 * a catering push.
 */
export function CateringOwnerScreen({
  refreshKey = 0,
  onChanged,
  onBack,
  onOpenOwnerMenu,
}: {
  /** Bumped when a catering push lands while the screen is up. */
  refreshKey?: number;
  /** After an answer — the burger's badge re-reads the summary. */
  onChanged?: () => void;
  /** Absent when this screen IS the login's home — no arrow to itself. */
  onBack?: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const [rows, setRows] = useState<StaffCatering[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The card whose answer is being saved — its buttons show a spinner. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Answered cards the owner reopened with "Change". */
  const [editing, setEditing] = useState<Set<string>>(new Set());

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffCatering(staffToken);
    setLoaded(true);
    if (res.ok) {
      setRows(res.data);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    // Keep whatever is on screen: a stale list beats an empty one.
    else setFailed(true);
  }, [staffToken, clearStaff]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const answer = useCallback(
    async (id: string, status: "confirmed" | "declined"): Promise<void> => {
      if (!staffToken || busyId) return;
      setBusyId(id);
      const res = await setStaffCateringStatus(staffToken, id, status);
      setBusyId(null);
      if (res.ok) {
        // Patch the one card now; the re-read below confirms it.
        setRows((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
        setEditing((set) => {
          const next = new Set(set);
          next.delete(id);
          return next;
        });
        onChanged?.();
        void load();
        return;
      }
      if (res.error === "unauthorized") clearStaff();
      else setFailed(true);
    },
    [staffToken, busyId, clearStaff, load, onChanged],
  );

  const statusLabel: Record<string, string> = {
    requested: t.staffResRequested,
    confirmed: t.resStatusConfirmed,
    declined: t.resStatusDeclined,
    cancelled: t.staffResCancelled,
  };

  const groups = groupByDate(rows);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.staffCatTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
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
        {failed ? <Text style={styles.failed}>{t.staffLoadFailed}</Text> : null}

        {!loaded ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="restaurant-outline" size={34} color={colors.inkSoft} />
            <Text style={styles.emptyTitle}>{t.staffCatEmpty}</Text>
          </View>
        ) : (
          groups.map(([date, list]) => (
            <View key={date} style={{ gap: 10 }}>
              <Text style={styles.day}>{dayHeading(date, lang, t)}</Text>
              {list.map((r) => {
                const open = r.status === "requested";
                const showButtons = open || editing.has(r.id);
                const busy = busyId === r.id;
                return (
                  <View key={r.id} style={[styles.card, open && styles.cardOpen]}>
                    <View style={styles.topRow}>
                      <Text style={[styles.time, !r.time && styles.timeOpen]}>
                        {r.time ?? t.staffCatAnyTime}
                      </Text>
                      <View style={styles.guests}>
                        <Ionicons name="people-outline" size={16} color={colors.inkSoft} />
                        <Text style={styles.guestsText}>{r.guests}</Text>
                      </View>
                      <View style={[styles.pill, pillStyle(r.status)]}>
                        <Text style={[styles.pillText, pillTextStyle(r.status)]} numberOfLines={1}>
                          {statusLabel[r.status] ?? r.status}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.name}>{r.name}</Text>
                    {r.phone ? (
                      <Pressable
                        onPress={() => void Linking.openURL(`tel:${r.phone.replace(/\s+/g, "")}`)}
                        accessibilityRole="link"
                        hitSlop={8}
                        style={({ pressed }) => [styles.phoneRow, pressed && { opacity: 0.6 }]}
                      >
                        <Ionicons name="call-outline" size={15} color={colors.red} />
                        <Text style={styles.phone}>{r.phone}</Text>
                      </Pressable>
                    ) : null}
                    {r.email ? (
                      <Pressable
                        onPress={() => void Linking.openURL(`mailto:${r.email}`)}
                        accessibilityRole="link"
                        hitSlop={8}
                        style={({ pressed }) => [styles.phoneRow, pressed && { opacity: 0.6 }]}
                      >
                        <Ionicons name="mail-outline" size={15} color={colors.red} />
                        <Text style={styles.phone}>{r.email}</Text>
                      </Pressable>
                    ) : null}
                    {r.location ? (
                      <View style={styles.phoneRow}>
                        <Ionicons name="location-outline" size={15} color={colors.inkSoft} />
                        <Text style={styles.note}>{r.location}</Text>
                      </View>
                    ) : null}
                    {r.message ? <Text style={styles.note}>„{r.message}“</Text> : null}

                    {showButtons ? (
                      <View style={styles.actions}>
                        <Pressable
                          onPress={() => void answer(r.id, "confirmed")}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={`${t.staffResConfirm} ${r.name}`}
                          style={({ pressed }) => [
                            styles.btn,
                            styles.btnConfirm,
                            (pressed || busy) && { opacity: 0.7 },
                          ]}
                        >
                          {busy ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <>
                              <Ionicons name="checkmark" size={18} color="#fff" />
                              <Text style={styles.btnConfirmText}>{t.staffResConfirm}</Text>
                            </>
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => void answer(r.id, "declined")}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={`${t.staffResDecline} ${r.name}`}
                          style={({ pressed }) => [
                            styles.btn,
                            styles.btnDecline,
                            (pressed || busy) && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons name="close" size={18} color={colors.danger} />
                          <Text style={styles.btnDeclineText}>{t.staffResDecline}</Text>
                        </Pressable>
                      </View>
                    ) : r.status === "confirmed" || r.status === "declined" ? (
                      <Pressable
                        onPress={() => setEditing((set) => new Set(set).add(r.id))}
                        accessibilityRole="button"
                        hitSlop={8}
                        style={({ pressed }) => [styles.change, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.changeText}>{t.staffResChange}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** Rows arrive soonest event first; keep that order and cut at each date. */
function groupByDate(rows: StaffCatering[]): [string, StaffCatering[]][] {
  const groups: [string, StaffCatering[]][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last[0] === r.date) last[1].push(r);
    else groups.push([r.date, [r]]);
  }
  return groups;
}

/** "Heute · Do., 9. Okt." — today and tomorrow named, every day dated. */
function dayHeading(
  date: string,
  lang: Parameters<typeof localeTag>[0],
  t: { staffResToday: string; staffResTomorrow: string },
): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const day = new Date(y, m - 1, d);
  const label = day.toLocaleDateString(localeTag(lang), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return `${t.staffResToday} · ${label}`;
  if (diff === 1) return `${t.staffResTomorrow} · ${label}`;
  return label;
}

function pillStyle(status: string): object {
  if (status === "confirmed") return styles.pillDone;
  if (status === "requested") return styles.pillOpen;
  return styles.pillOff;
}

function pillTextStyle(status: string): object {
  if (status === "confirmed") return styles.pillTextDone;
  if (status === "requested") return styles.pillTextOpen;
  return styles.pillTextOff;
}

const GREEN = "#3f7030";

const styles = StyleSheet.create({
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 34,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { color: colors.ink, fontSize: 15.5, ...fonts.bodyBold, textAlign: "center" },
  day: { color: colors.inkSoft, ...fonts.bodyBold, fontSize: 13, marginTop: 4 },
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
  /** Still waiting for an answer — the card that asks for attention. */
  cardOpen: { borderColor: colors.gold, borderWidth: 1.5 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  time: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 20 },
  /** "Time open" is text, not a clock — smaller so it doesn't shout. */
  timeOpen: { fontSize: 14, color: colors.inkSoft },
  guests: { flexDirection: "row", alignItems: "center", gap: 4 },
  guestsText: { color: colors.inkSoft, ...fonts.bodyBold, fontSize: 14 },
  name: { color: colors.ink, ...fonts.bodyBold, fontSize: 15.5, marginTop: 2 },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  phone: { color: colors.red, ...fonts.bodySemi, fontSize: 14 },
  note: { color: colors.inkSoft, ...fonts.body, fontSize: 13, lineHeight: 18 },
  pill: {
    marginLeft: "auto",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  pillText: { fontSize: 11.5, ...fonts.bodyBold },
  pillOpen: { backgroundColor: "#fdf4dc", borderColor: colors.gold },
  pillTextOpen: { color: "#7a5a00" },
  pillDone: { backgroundColor: "#e9f3e4", borderColor: GREEN },
  pillTextDone: { color: GREEN },
  pillOff: { backgroundColor: "#fdeee6", borderColor: colors.danger },
  pillTextOff: { color: colors.danger },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  btnConfirm: { backgroundColor: GREEN },
  btnConfirmText: { color: "#fff", ...fonts.bodyBold, fontSize: 14.5 },
  btnDecline: { borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.creamCard },
  btnDeclineText: { color: colors.danger, ...fonts.bodyBold, fontSize: 14.5 },
  change: { alignSelf: "flex-end", marginTop: 4 },
  changeText: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 13,
    textDecorationLine: "underline",
  },
});
