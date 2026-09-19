import React, { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReservationView } from "./api";
import { fetchMyReservations, fetchReservation } from "./api";
import type { StoredReservation } from "./reservations-store";
import { listStoredReservations } from "./reservations-store";
import { localeTag, useI18n } from "./i18n";
import { colors, fonts, radius } from "./theme";

/**
 * Konto → Reservierungen: where a filed table request turns into an
 * answer.
 *
 * Two sources, one list. The DEVICE list is the baseline — a reservation
 * needs no account, so the id + token stored when the request was filed
 * are the guest's whole claim to it, and that is what the signed-out
 * case has. When there IS an account, `/api/v1/me/reservations` adds the
 * ones filed on the guest's other phone; the server's copy always wins
 * on a collision, because the restaurant may have moved the status since
 * this device last looked.
 *
 * Everything is read tolerantly: a server that predates the status
 * routes answers nothing, and a card then shows the booking WITHOUT a
 * badge rather than disappearing.
 */

/** How many device-only reservations get a status lookup — same cap and
 *  the same settle-individually posture as the orders list. */
const STATUS_LOOKUPS = 20;

interface Row {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  guests: number;
  name: string;
  /** Null until (or unless) the server answers — no badge in that case. */
  status: string | null;
  note: string | null;
  phone: string | null;
}

function fromStored(r: StoredReservation): Row {
  return {
    id: r.id,
    date: r.date,
    time: r.time,
    guests: r.guests,
    name: r.name,
    status: null,
    note: null,
    phone: null,
  };
}

function fromView(v: ReservationView): Row {
  return {
    id: v.id,
    date: v.date,
    time: v.time,
    guests: v.guests,
    name: v.name,
    status: v.status,
    note: v.note,
    phone: v.venue.phone,
  };
}

/** Sort key. An unparseable date sorts to the far past rather than
 *  crashing the comparison — it lands under "Past", which is where a
 *  reservation nobody can place in time belongs. */
function when(r: Row): number {
  const d = new Date(`${r.date}T${r.time || "00:00"}:00`);
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function ReservationsCard({ token }: { token: string | null }): React.ReactElement | null {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const device = await listStoredReservations().catch(() => [] as StoredReservation[]);
      if (!alive) return;
      // Show what the device knows immediately; the lookups only enrich it.
      setRows(device.map(fromStored));
      const [details, mine] = await Promise.all([
        // Tolerant fan-out: `fetchReservation` resolves to null rather
        // than throwing, so one withdrawn booking can't hide the rest.
        Promise.all(device.slice(0, STATUS_LOOKUPS).map((r) => fetchReservation(r.id, r.token))),
        fetchMyReservations(token),
      ]);
      if (!alive) return;
      const merged = new Map<string, Row>();
      for (const d of device) merged.set(d.id, fromStored(d));
      for (const v of details) if (v) merged.set(v.id, fromView(v));
      for (const v of mine) merged.set(v.id, fromView(v));
      setRows([...merged.values()]);
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const tag = localeTag(lang);
  const now = Date.now();
  const upcoming = rows.filter((r) => when(r) >= now).sort((a, b) => when(a) - when(b));
  const past = rows.filter((r) => when(r) < now).sort((a, b) => when(b) - when(a));

  // Nothing filed on this device and nothing on the account: the whole
  // section stays away rather than showing an empty state.
  if (rows.length === 0) return null;

  const dateLabel = (iso: string): string => {
    if (!iso) return "";
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(tag, { weekday: "short", day: "numeric", month: "short" });
  };

  const line = (r: Row): string =>
    [dateLabel(r.date), r.time, `${r.guests} ${r.guests === 1 ? t.guest : t.guests}`]
      .filter(Boolean)
      .join(" · ");

  /** Icon, word and tone per status. An unknown string (a workflow this
   *  build predates) is shown as itself in the neutral tone. */
  const badge = (status: string | null): { icon: string; text: string; tone: string } | null => {
    if (!status) return null;
    if (status === "requested") return { icon: "⏳", text: t.resStatusRequested, tone: "warm" };
    if (status === "confirmed") return { icon: "✓", text: t.resStatusConfirmed, tone: "good" };
    if (status === "declined") return { icon: "✕", text: t.resStatusDeclined, tone: "grey" };
    return { icon: "•", text: status, tone: "neutral" };
  };

  const card = (r: Row, dim: boolean): React.ReactElement => {
    const b = badge(r.status);
    // Only worth ringing while the table is still in question.
    const callable = Boolean(r.phone) && r.status !== "confirmed";
    return (
      <View key={r.id} style={[styles.row, dim && styles.rowDim]}>
        <View style={styles.headRow}>
          <Text style={styles.when} numberOfLines={1}>
            {line(r)}
          </Text>
          {b ? (
            <View
              style={[
                styles.pill,
                b.tone === "warm"
                  ? styles.pillWarm
                  : b.tone === "good"
                    ? styles.pillGood
                    : styles.pillGrey,
              ]}
            >
              <Text style={styles.pillIcon}>{b.icon}</Text>
              <Text
                style={[
                  styles.pillText,
                  b.tone === "warm"
                    ? styles.pillTextWarm
                    : b.tone === "good"
                      ? styles.pillTextGood
                      : styles.pillTextGrey,
                ]}
                numberOfLines={1}
              >
                {b.text}
              </Text>
            </View>
          ) : null}
        </View>
        {r.name ? <Text style={styles.who}>{r.name}</Text> : null}
        {r.note ? <Text style={styles.note}>{r.note}</Text> : null}
        {callable && r.phone ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${r.phone ?? ""}`)}
            hitSlop={6}
            accessibilityRole="link"
            accessibilityLabel={`${t.resCall} ${r.phone}`}
          >
            <Text style={styles.call}>{t.resCall}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t.resSectionTitle}</Text>
      {upcoming.map((r) => card(r, false))}
      {past.length > 0 ? (
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>{t.resPast}</Text>
          <View style={styles.dividerLine} />
        </View>
      ) : null}
      {past.map((r) => card(r, true))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: colors.ink, fontSize: 15, ...fonts.bodyHeavy },
  row: {
    gap: 4,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // A table that has been and gone: still there to look up, no longer
  // asking for attention.
  rowDim: { opacity: 0.6 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  when: { color: colors.ink, ...fonts.bodyBold, fontSize: 14, flexShrink: 1 },
  who: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  note: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  call: { color: colors.red, ...fonts.bodyBold, fontSize: 12.5, marginTop: 4 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingStart: 7,
    paddingEnd: 9,
  },
  pillIcon: { fontSize: 11, lineHeight: 14 },
  pillText: { fontSize: 11.5, ...fonts.bodyBold },
  // Waiting on the restaurant: warm, the programme's gold — attention
  // without alarm.
  pillWarm: { backgroundColor: "#fbf0d8", borderColor: colors.goldSoft },
  pillTextWarm: { color: colors.gold },
  // The table is held: the receipt's green.
  pillGood: { backgroundColor: "#e9f3e4", borderColor: colors.positive },
  pillTextGood: { color: colors.positive },
  // Declined, or a status this build doesn't know: quiet.
  pillGrey: { backgroundColor: colors.cream, borderColor: colors.line },
  pillTextGrey: { color: colors.inkSoft },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerLabel: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
