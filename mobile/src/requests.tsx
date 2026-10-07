import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useAuth } from "./auth";
import type { StaffCatering, StaffReservation } from "./staff";
import {
  fetchStaffCatering,
  fetchStaffReservations,
  setStaffCateringStatus,
  setStaffReservationStatus,
} from "./staff";
import { fill, localeTag, useI18n, type Lang } from "./i18n";
import { SHEET_MAX } from "./layout";
import { colors, fonts, radius } from "./theme";

/**
 * Table reservations and catering enquiries ON THE ORDER BOARD (owner,
 * 2026-10-07: "a new reservation or catering request should appear where
 * new orders appear; after confirming it moves to its own place; a bubble
 * in the left corner shows how many, and tapping it shows both kinds").
 *
 *   - `useRequests` reads both lists (each only when the login has that
 *     box), every 30 s and whenever the board is told to refresh.
 *   - `RequestCard` is an unanswered request, at the top of the board,
 *     with Confirm / Decline. Once answered it leaves the board — the
 *     Reservations and Catering screens keep it.
 *   - `RequestsBubble` sits in the header's start corner: the number of
 *     upcoming reservations of both kinds, red while any is unanswered.
 *   - `RequestsSheet` is what the bubble opens: both kinds, soonest first,
 *     with a way through to the full screens.
 */

export type Request =
  | { kind: "table"; id: string; date: string; time: string | null; item: StaffReservation }
  | { kind: "catering"; id: string; date: string; time: string | null; item: StaffCatering };

const POLL_MS = 30_000;

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Soonest first; a request with no time sorts to the end of its day. */
function byWhen(a: Request, b: Request): number {
  return `${a.date} ${a.time ?? "99:99"}`.localeCompare(`${b.date} ${b.time ?? "99:99"}`);
}

export function useRequests(refreshKey: number): {
  /** Upcoming (today on) and still open or confirmed — the bubble's list. */
  upcoming: Request[];
  /** Unanswered — the board's cards. */
  pending: Request[];
  answer: (request: Request, status: "confirmed" | "declined") => Promise<boolean>;
  busyId: string | null;
  /** Ids seen as pending for the first time on the latest read — the
   *  board rings for these like for a new order. Empty on the first read. */
  arrivals: string[];
} {
  const { staffToken, staffCan, clearStaff } = useAuth();
  const canTables = staffCan("reservations");
  const canCatering = staffCan("catering");
  const [tables, setTables] = useState<StaffReservation[]>([]);
  const [catering, setCatering] = useState<StaffCatering[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [arrivals, setArrivals] = useState<string[]>([]);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const [r, c] = await Promise.all([
      canTables ? fetchStaffReservations(staffToken) : Promise.resolve(null),
      canCatering ? fetchStaffCatering(staffToken) : Promise.resolve(null),
    ]);
    if ((r && !r.ok && r.error === "unauthorized") || (c && !c.ok && c.error === "unauthorized")) {
      clearStaff();
      return;
    }
    // A failed read keeps what is on screen — a stale list beats a blank one.
    const nextTables = r?.ok ? r.data : null;
    const nextCatering = c?.ok ? c.data : null;
    if (nextTables) setTables(nextTables);
    if (nextCatering) setCatering(nextCatering);

    const pendingIds = [
      ...(nextTables ?? []).filter((x) => x.status === "requested").map((x) => `t:${x.id}`),
      ...(nextCatering ?? []).filter((x) => x.status === "requested").map((x) => `c:${x.id}`),
    ];
    if (seen.current === null) {
      seen.current = new Set(pendingIds);
      return;
    }
    const fresh = pendingIds.filter((id) => !seen.current!.has(id));
    for (const id of pendingIds) seen.current.add(id);
    if (fresh.length > 0) setArrivals(fresh);
  }, [staffToken, canTables, canCatering, clearStaff]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  const today = todayISO();
  const now = Date.now();
  const all: Request[] = [
    ...tables
      .filter((x) => new Date(x.at).getTime() >= now - 2 * 3_600_000)
      .map((item): Request => ({
        kind: "table",
        id: item.id,
        date: item.date,
        time: item.time,
        item,
      })),
    ...catering
      .filter((x) => x.date >= today)
      .map((item): Request => ({
        kind: "catering",
        id: item.id,
        date: item.date,
        time: item.time,
        item,
      })),
  ].sort(byWhen);
  const upcoming = all.filter(
    (x) => x.item.status === "requested" || x.item.status === "confirmed",
  );
  const pending = all.filter((x) => x.item.status === "requested");

  const answer = useCallback(
    async (request: Request, status: "confirmed" | "declined"): Promise<boolean> => {
      if (!staffToken || busyId) return false;
      setBusyId(request.id);
      const res =
        request.kind === "table"
          ? await setStaffReservationStatus(staffToken, request.id, status)
          : await setStaffCateringStatus(staffToken, request.id, status);
      setBusyId(null);
      if (!res.ok) {
        if (res.error === "unauthorized") clearStaff();
        return false;
      }
      if (request.kind === "table") {
        setTables((list) => list.map((x) => (x.id === request.id ? { ...x, status } : x)));
      } else {
        setCatering((list) => list.map((x) => (x.id === request.id ? { ...x, status } : x)));
      }
      void load();
      return true;
    },
    [staffToken, busyId, clearStaff, load],
  );

  return { upcoming, pending, answer, busyId, arrivals };
}

/** "Heute · Di., 7. Okt." / "Morgen · …" / "Do., 9. Okt." */
export function requestDay(
  date: string,
  lang: Lang,
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

/** An unanswered request on the board — same card family as an order. */
export function RequestCard({
  request,
  busy,
  onAnswer,
}: {
  request: Request;
  busy: boolean;
  onAnswer: (status: "confirmed" | "declined") => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { item } = request;
  const isTable = request.kind === "table";
  const note = isTable ? request.item.note : request.item.message;
  const place = isTable ? null : request.item.location;
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.kind, isTable ? styles.kindTable : styles.kindCatering]}>
          <Ionicons
            name={isTable ? "restaurant-outline" : "wine-outline"}
            size={14}
            color={isTable ? colors.red : "#7a5a00"}
          />
          <Text style={[styles.kindText, !isTable && { color: "#7a5a00" }]}>
            {isTable ? t.boardRequestTable : t.boardRequestCatering}
          </Text>
        </View>
        <View style={styles.guests}>
          <Ionicons name="people-outline" size={16} color={colors.inkSoft} />
          <Text style={styles.guestsText}>{item.guests}</Text>
        </View>
      </View>
      <Text style={styles.when}>
        {requestDay(request.date, lang, t)} · {request.time ?? t.staffCatAnyTime}
      </Text>
      <Text style={styles.name}>{item.name}</Text>
      {item.phone ? (
        <Pressable
          onPress={() => void Linking.openURL(`tel:${item.phone.replace(/\s+/g, "")}`)}
          accessibilityRole="link"
          hitSlop={8}
          style={({ pressed }) => [styles.line, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="call-outline" size={15} color={colors.red} />
          <Text style={styles.phone}>{item.phone}</Text>
        </Pressable>
      ) : null}
      {place ? (
        <View style={styles.line}>
          <Ionicons name="location-outline" size={15} color={colors.inkSoft} />
          <Text style={styles.note}>{place}</Text>
        </View>
      ) : null}
      {note ? <Text style={styles.note}>„{note}“</Text> : null}
      <View style={styles.actions}>
        <Pressable
          onPress={() => onAnswer("confirmed")}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`${t.staffResConfirm} ${item.name}`}
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
          onPress={() => onAnswer("declined")}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`${t.staffResDecline} ${item.name}`}
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
    </View>
  );
}

/** The header's start-corner bubble: how many reservations are coming up. */
export function RequestsBubble({
  count,
  urgent,
  onPress,
}: {
  count: number;
  /** Any of them still unanswered — the badge turns red. */
  urgent: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={fill(t.requestsBubbleAria, { count })}
      style={({ pressed }) => [styles.bubble, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name="calendar" size={22} color={colors.red} />
      {count > 0 ? (
        <View style={[styles.bubbleBadge, urgent ? styles.bubbleBadgeUrgent : null]}>
          <Text style={styles.bubbleBadgeText}>{count > 99 ? "99" : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** What the bubble opens: both kinds, soonest first. */
export function RequestsSheet({
  visible,
  upcoming,
  onClose,
  onOpenTables,
  onOpenCatering,
}: {
  visible: boolean;
  upcoming: Request[];
  onClose: () => void;
  onOpenTables?: () => void;
  onOpenCatering?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffCan } = useAuth();
  const sections: { kind: Request["kind"]; title: string; open?: () => void; show: boolean }[] = [
    { kind: "table", title: t.requestsTables, open: onOpenTables, show: staffCan("reservations") },
    {
      kind: "catering",
      title: t.requestsCatering,
      open: onOpenCatering,
      show: staffCan("catering"),
    },
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t.requestsSheetTitle}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
            {sections
              .filter((s) => s.show)
              .map((section) => {
                const rows = upcoming.filter((r) => r.kind === section.kind);
                return (
                  <View key={section.kind} style={{ gap: 8 }}>
                    <View style={styles.sectionHead}>
                      <Text style={styles.sectionTitle}>
                        {section.title} · {rows.length}
                      </Text>
                      {section.open ? (
                        <Pressable
                          onPress={() => {
                            onClose();
                            section.open!();
                          }}
                          accessibilityRole="button"
                          hitSlop={8}
                        >
                          <Text style={styles.showAll}>{t.requestsShowAll}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {rows.length === 0 ? (
                      <Text style={styles.none}>{t.requestsNone}</Text>
                    ) : (
                      rows.map((r) => {
                        const open = r.item.status === "requested";
                        return (
                          <View key={r.id} style={[styles.row, open && styles.rowOpen]}>
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.rowWhen}>
                                {requestDay(r.date, lang, t)} · {r.time ?? t.staffCatAnyTime}
                              </Text>
                              <Text style={styles.rowName} numberOfLines={1}>
                                {r.item.name} · {r.item.guests}{" "}
                                {r.item.guests === 1 ? t.guest : t.guests}
                              </Text>
                            </View>
                            <View style={[styles.pill, open ? styles.pillOpen : styles.pillDone]}>
                              <Text
                                style={[
                                  styles.pillText,
                                  open ? styles.pillTextOpen : styles.pillTextDone,
                                ]}
                              >
                                {open ? t.staffResRequested : t.resStatusConfirmed}
                              </Text>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                );
              })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const GREEN = "#3f7030";

const styles = StyleSheet.create({
  card: {
    gap: 4,
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: radius.lg,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  kind: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  kindTable: { backgroundColor: "#fdeee6", borderColor: colors.red },
  kindCatering: { backgroundColor: "#fdf4dc", borderColor: colors.gold },
  kindText: { color: colors.red, ...fonts.bodyBold, fontSize: 12 },
  guests: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  guestsText: { color: colors.inkSoft, ...fonts.bodyBold, fontSize: 14 },
  when: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 16, marginTop: 2 },
  name: { color: colors.ink, ...fonts.bodyBold, fontSize: 15 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  phone: { color: colors.red, ...fonts.bodySemi, fontSize: 14 },
  note: { color: colors.inkSoft, ...fonts.body, fontSize: 13, lineHeight: 18 },
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
  bubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 20,
    paddingHorizontal: 5,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.cream,
  },
  bubbleBadgeUrgent: { backgroundColor: colors.danger },
  bubbleBadgeText: { color: "#fff", fontSize: 11, ...fonts.bodyHeavy },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
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
    maxHeight: "85%",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: colors.ink, ...fonts.display, fontSize: 22, flex: 1 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 15 },
  showAll: { color: colors.red, ...fonts.bodyBold, fontSize: 13, textDecorationLine: "underline" },
  none: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowOpen: { borderColor: colors.gold, borderWidth: 1.5 },
  rowWhen: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  rowName: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  pill: { borderRadius: radius.pill, borderWidth: 1, paddingVertical: 3, paddingHorizontal: 9 },
  pillText: { fontSize: 11.5, ...fonts.bodyBold },
  pillOpen: { backgroundColor: "#fdf4dc", borderColor: colors.gold },
  pillTextOpen: { color: "#7a5a00" },
  pillDone: { backgroundColor: "#e9f3e4", borderColor: GREEN },
  pillTextDone: { color: GREEN },
});
