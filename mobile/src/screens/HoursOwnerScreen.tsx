import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import type { StaffHoursDay, StaffHoursSlot, StaffHoursWeek } from "../staff";
import { HOURS_DAYS, fetchStaffHours, updateStaffHours } from "../staff";
import {
  BrandHeader,
  FieldLabel,
  OutlineButton,
  PrimaryButton,
  RequiredLegend,
} from "../components";
import { fill, useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, radius } from "../theme";

/**
 * When the restaurant is open — edited from the counter (P7, owner).
 *
 * The week is ONE document: seven days, each either closed or carrying
 * one or two windows, saved together. That is not a UI shortcut — hours
 * are read as a table, and a per-day save would let an owner change
 * Monday, get distracted by a guest, and leave Tuesday half-edited on a
 * public menu.
 *
 * Two clocks exist and only one of them counts. `timezone` and `openNow`
 * come from the SERVER, against the venue's own zone; this screen shows
 * them and re-derives neither, because the tablet on the pass may be set
 * to anything at all and "are we open?" is not a question a wrong device
 * clock gets to answer.
 *
 * Times are picked, never typed: a 15-minute grid in the same option
 * sheet the offer editor and the reservation sheet use, so there is no
 * "7:5" to validate and no keyboard to fight on a tablet.
 */

/** The grid the pickers offer — 15 minutes is the finest granularity a
 *  kitchen has ever needed, and it keeps the list scannable at 96 rows. */
const STEP_MINUTES = 15;

/** What a day gets when it is opened for the first time: a plausible
 *  service, so the owner adjusts two times instead of inventing them. */
const DEFAULT_SLOT: StaffHoursSlot = { open: "09:00", close: "22:00" };

/** The editor offers at most this many windows per day (lunch + dinner).
 *  A day that ARRIVES with more keeps them all — they stay visible and
 *  removable, because silently dropping one would delete the venue's
 *  hours on the next save. */
const MAX_SLOTS = 2;

/** Monday–Friday, the days "copy Monday" fills in. */
const WEEKDAYS: readonly StaffHoursDay[] = ["tue", "wed", "thu", "fri"];

interface Notice {
  tone: "ok" | "bad";
  text: string;
}

/** Which input the option sheet is currently filling. */
interface PickerTarget {
  day: StaffHoursDay;
  index: number;
  which: "open" | "close";
}

/** Structural copy — the editor mutates days in place otherwise, and
 *  React would not see a change it could re-render. */
function cloneWeek(week: StaffHoursWeek): StaffHoursWeek {
  return Object.fromEntries(
    HOURS_DAYS.map((day) => [
      day,
      { closed: week[day].closed, slots: week[day].slots.map((s) => ({ ...s })) },
    ]),
  ) as StaffHoursWeek;
}

/**
 * A day is saveable when it is closed, or open with at least one window
 * whose two ends differ.
 *
 * Deliberately NOT checked: whether the close is "after" the open. A
 * venue that serves 17:00–02:00 is a normal late kitchen, and the server
 * reads that as crossing midnight — refusing it here would make the app
 * stricter than the product.
 */
function dayIsValid(day: { closed: boolean; slots: StaffHoursSlot[] }): boolean {
  if (day.closed) return true;
  if (day.slots.length === 0) return false;
  return day.slots.every((s) => s.open !== "" && s.close !== "" && s.open !== s.close);
}

export function HoursOwnerScreen({
  onBack,
  onOpenOwnerMenu,
}: {
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();

  const [week, setWeek] = useState<StaffHoursWeek | null>(null);
  const [timezone, setTimezone] = useState("");
  const [openNow, setOpenNow] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The day the server (or this screen) refused, highlighted on its own
   *  row rather than as a sentence at the top of a seven-row form. */
  const [badDay, setBadDay] = useState<StaffHoursDay | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const times = useMemo(() => {
    const out: string[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += STEP_MINUTES) {
      out.push(
        `${`${Math.floor(minutes / 60)}`.padStart(2, "0")}:${`${minutes % 60}`.padStart(2, "0")}`,
      );
    }
    return out;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffHours(staffToken);
    setLoaded(true);
    if (res.ok) {
      setWeek(res.data.hours);
      setTimezone(res.data.timezone);
      setOpenNow(res.data.openNow);
      setDirty(false);
      setBadDay(null);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    else setNotice({ tone: "bad", text: t.staffLoadFailed });
  }, [staffToken, clearStaff, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every edit goes through here: one place that clones, marks the form
   *  dirty and clears the stale verdicts an edit invalidates. */
  const edit = useCallback((mutate: (draft: StaffHoursWeek) => void): void => {
    setWeek((current) => {
      if (!current) return current;
      const draft = cloneWeek(current);
      mutate(draft);
      return draft;
    });
    setDirty(true);
    setBadDay(null);
    setNotice(null);
    // The server's "open now" was computed against the SAVED hours, so
    // an unsaved edit makes it a claim we can no longer stand behind.
    setOpenNow(null);
  }, []);

  const toggleClosed = (day: StaffHoursDay, closed: boolean): void =>
    edit((draft) => {
      draft[day].closed = closed;
      // Opening a day that has never had times gets a service to adjust
      // rather than an empty row with a save button that refuses.
      if (!closed && draft[day].slots.length === 0) draft[day].slots = [{ ...DEFAULT_SLOT }];
    });

  const addSlot = (day: StaffHoursDay): void =>
    edit((draft) => {
      const last = draft[day].slots[draft[day].slots.length - 1];
      // The second window starts where a lunch break plausibly ends, so
      // it never lands on top of the first one.
      draft[day].slots.push(last ? { open: last.close, close: "22:00" } : { ...DEFAULT_SLOT });
    });

  const removeSlot = (day: StaffHoursDay, index: number): void =>
    edit((draft) => {
      draft[day].slots.splice(index, 1);
      // A day with no windows left is a closed day — say so, rather than
      // leaving a row that cannot be saved.
      if (draft[day].slots.length === 0) draft[day].closed = true;
    });

  const setTime = (target: PickerTarget, value: string): void =>
    edit((draft) => {
      const slot = draft[target.day].slots[target.index];
      if (slot) slot[target.which] = value;
    });

  const copyMonday = (): void => {
    edit((draft) => {
      for (const day of WEEKDAYS) {
        draft[day] = {
          closed: draft.mon.closed,
          slots: draft.mon.slots.map((s) => ({ ...s })),
        };
      }
    });
    setNotice({ tone: "ok", text: t.hoursCopied });
  };

  const dayLabel = (day: StaffHoursDay): string =>
    t.days[HOURS_DAYS.indexOf(day)] ?? day.toUpperCase();

  const save = useCallback(async (): Promise<void> => {
    if (!week || !staffToken || busy) return;
    const offender = HOURS_DAYS.find((day) => !dayIsValid(week[day]));
    if (offender) {
      setBadDay(offender);
      setNotice({ tone: "bad", text: fill(t.hoursBadDay, { day: dayLabel(offender) }) });
      return;
    }
    // Closed days travel with no windows whatever the editor still holds
    // in memory, so re-opening a day mid-edit never resurrects times the
    // owner thought they had removed.
    const payload = Object.fromEntries(
      HOURS_DAYS.map((day) => [
        day,
        week[day].closed
          ? { closed: true, slots: [] }
          : { closed: false, slots: week[day].slots.map((s) => ({ ...s })) },
      ]),
    ) as StaffHoursWeek;

    setBusy(true);
    setNotice(null);
    const res = await updateStaffHours(staffToken, payload);
    setBusy(false);
    if (res.ok) {
      setWeek(res.data.hours);
      setTimezone(res.data.timezone);
      setOpenNow(res.data.openNow);
      setDirty(false);
      setBadDay(null);
      setNotice({ tone: "ok", text: t.hoursSaved });
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      return;
    }
    const field = HOURS_DAYS.find((day) => day === res.field) ?? null;
    setBadDay(field);
    setNotice({
      tone: "bad",
      text: field ? fill(t.hoursBadDay, { day: dayLabel(field) }) : t.hoursSaveFailed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, staffToken, busy, clearStaff, t]);

  const pickerValue =
    picker && week ? (week[picker.day].slots[picker.index]?.[picker.which] ?? "") : "";

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.ownerHours} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 40,
          gap: 12,
          ...layout.content,
        }}
      >
        {!loaded ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : !week ? (
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
              {openNow === null ? null : (
                <View
                  style={[styles.statePill, openNow ? styles.statePillOn : styles.statePillOff]}
                >
                  <Text style={[styles.statePillText, openNow ? styles.stateOn : styles.stateOff]}>
                    {openNow ? t.hoursOpenNow : t.hoursClosedNow}
                  </Text>
                </View>
              )}
              {timezone ? (
                <Text style={styles.hint}>{fill(t.hoursTimezone, { zone: timezone })}</Text>
              ) : null}
              <Text style={styles.hint}>{t.hoursHint}</Text>
              {/* `dayIsValid` refuses a slot with only one end filled in,
                  so both times on an OPEN day carry the mark; a closed
                  day has no slots at all. */}
              <RequiredLegend />
            </View>

            {HOURS_DAYS.map((day) => {
              const entry = week[day];
              const wrong = badDay === day;
              return (
                <View key={day} style={[styles.card, wrong && styles.cardBad]}>
                  <View style={styles.dayHead}>
                    <Text style={styles.dayName}>{dayLabel(day)}</Text>
                    <Text style={styles.closedLabel}>{t.hoursClosed}</Text>
                    <Switch
                      value={entry.closed}
                      onValueChange={(next) => toggleClosed(day, next)}
                      accessibilityLabel={`${dayLabel(day)} — ${t.hoursClosed}`}
                      trackColor={{ false: colors.line, true: colors.red }}
                      thumbColor={colors.cream}
                    />
                  </View>

                  {entry.closed ? null : (
                    <>
                      {entry.slots.map((slot, index) => (
                        <View key={`${day}-${index}`} style={styles.slotRow}>
                          <TimeField
                            label={t.hoursOpens}
                            value={slot.open}
                            a11y={`${dayLabel(day)} — ${t.hoursOpens}`}
                            onPress={() => setPicker({ day, index, which: "open" })}
                          />
                          <Text style={styles.dash}>–</Text>
                          <TimeField
                            label={t.hoursCloses}
                            value={slot.close}
                            a11y={`${dayLabel(day)} — ${t.hoursCloses}`}
                            onPress={() => setPicker({ day, index, which: "close" })}
                          />
                          {entry.slots.length > 1 ? (
                            <Pressable
                              onPress={() => removeSlot(day, index)}
                              accessibilityRole="button"
                              accessibilityLabel={`${dayLabel(day)} — ${t.hoursRemoveSlot}`}
                              style={({ pressed }) => [
                                styles.removeBtn,
                                pressed && { opacity: 0.6 },
                              ]}
                            >
                              <Ionicons name="close" size={18} color={colors.danger} />
                            </Pressable>
                          ) : (
                            // Keeps the two fields the same width whether or
                            // not the row can be removed.
                            <View style={styles.removeSpacer} />
                          )}
                        </View>
                      ))}

                      {entry.slots.length < MAX_SLOTS ? (
                        <Text
                          onPress={() => addSlot(day)}
                          suppressHighlighting
                          accessibilityRole="button"
                          accessibilityLabel={`${dayLabel(day)} — ${t.hoursAddSlot}`}
                          style={styles.addSlot}
                        >
                          {t.hoursAddSlot}
                        </Text>
                      ) : null}
                    </>
                  )}
                </View>
              );
            })}

            <OutlineButton label={t.hoursCopyMonday} icon="copy-outline" onPress={copyMonday} />
            <PrimaryButton
              label={t.hoursSave}
              busyLabel={t.hoursSaving}
              busy={busy}
              disabled={!dirty || busy}
              onPress={() => void save()}
            />
          </>
        )}
      </ScrollView>

      {/* The option sheet the offer editor and the reservation sheet use —
          one interaction for "pick a time" everywhere in the app. */}
      <Modal visible={picker !== null} transparent animationType="fade">
        <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)}>
          <View style={styles.pickerSheet}>
            <ScrollView style={{ maxHeight: 400 }}>
              {times.map((time) => {
                const selected = time === pickerValue;
                return (
                  <Pressable
                    key={time}
                    onPress={() => {
                      if (picker) setTime(picker, time);
                      setPicker(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.option, selected && styles.optionActive]}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                      {time}
                    </Text>
                    {selected ? <Text style={{ color: colors.red }}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function TimeField({
  label,
  value,
  a11y,
  onPress,
}: {
  label: string;
  value: string;
  a11y: string;
  onPress: () => void;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required style={styles.fieldLabel} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${a11y}: ${value || "—"}`}
        style={({ pressed }) => [styles.dropdown, pressed && { opacity: 0.65 }]}
      >
        <Text style={styles.dropdownValue}>{value || "—"}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
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
    gap: 10,
  },
  /** The day the save refused — named in colour on its own row. */
  cardBad: { borderColor: colors.danger, borderWidth: 1.5 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  statePill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statePillOn: { backgroundColor: "#e9f3e4", borderColor: "#3f7030" },
  statePillOff: { backgroundColor: colors.cream, borderColor: colors.line },
  statePillText: { ...fonts.bodyHeavy, fontSize: 12.5 },
  stateOn: { color: "#3f7030" },
  stateOff: { color: colors.inkSoft },
  dayHead: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  dayName: { flex: 1, color: colors.ink, ...fonts.bodyHeavy, fontSize: 15.5 },
  closedLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  slotRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  field: { flex: 1, gap: 4 },
  fieldLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11.5 },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    // A wet thumb on a tablet propped at arm's length.
    minHeight: 44,
  },
  dropdownValue: { color: colors.ink, ...fonts.bodySemi, fontSize: 15 },
  chevron: { color: colors.inkSoft, fontSize: 14 },
  dash: { color: colors.inkSoft, ...fonts.body, fontSize: 15, paddingBottom: 12 },
  removeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  removeSpacer: { width: 44, height: 44 },
  addSlot: {
    color: colors.red,
    ...fonts.bodyBold,
    fontSize: 13.5,
    alignSelf: "flex-start",
    // Not a button, but still a full target.
    paddingVertical: 12,
    paddingEnd: 12,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20,10,5,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  pickerSheet: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 8,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: radius.md,
  },
  optionText: { color: colors.ink, ...fonts.body, fontSize: 15 },
  optionTextActive: { color: colors.red, ...fonts.bodyHeavy },
  optionActive: { backgroundColor: "#fdeee6" },
});
