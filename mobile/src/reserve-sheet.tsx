import React, { useMemo, useState } from "react";
import {
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
import { FieldLabel, QtyStepper, RequiredLegend } from "./components";
import Svg, { Circle, Path } from "react-native-svg";
import type { ApiMenu } from "./api";
import { createReservation } from "./api";
import { rememberReservation } from "./reservations-store";
import { localeTag, useI18n } from "./i18n";
import { monthTitle, reservationMonths, weekdayNames } from "./reservation-calendar";
import { colors, fonts, radius } from "./theme";

/**
 * Tisch reservieren — the app's table-booking sheet.
 *
 * Date and time come from `ordering.reservationSlots`, which the SERVER
 * enumerates from the venue's opening hours, so the picker can only
 * offer bookable moments and never drifts from what /api/reservations
 * accepts. The request lands as `requested`; the restaurant confirms by
 * phone, so there is nothing to pay and no sign-in needed.
 *
 * The server now enumerates the whole 60-day window it accepts, so the
 * DATE picker is a two-month calendar rather than the scrolling list of
 * days it used to be — sixty rows is not a date picker. The TIME picker
 * stays a list: a day has a dozen slots, and they are not a grid.
 */
export function ReserveSheet({
  menu,
  visible,
  onClose,
}: {
  menu: ApiMenu;
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const slots = menu.ordering.reservationSlots ?? [];

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const times = useMemo(() => slots.find((s) => s.date === date)?.times ?? [], [slots, date]);
  const dateLabel = (iso: string): string =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(localeTag(lang), {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });

  const missing = !date || !time || name.trim().length < 2 || phone.trim().length < 5;

  async function submit(): Promise<void> {
    if (busy || missing) return;
    setBusy(true);
    setError(null);
    const result = await createReservation({
      slug: menu.venue.slug,
      name: name.trim(),
      phone: phone.trim(),
      guests,
      date,
      time,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(
        result.error === "invalid_time"
          ? t.resTimeGone
          : result.error === "rate_limited"
            ? t.resTooMany
            : t.resFailed,
      );
      return;
    }
    // Remember it on THIS device: the id + token the server just minted
    // are the guest's whole claim to the request, and holding them here
    // is what lets Konto → Reservierungen show the restaurant's answer
    // later. A server that predates the fields sends neither — the
    // confirmation below then simply has nothing to follow up.
    if (result.id && result.token) {
      await rememberReservation({
        id: result.id,
        token: result.token,
        date,
        time,
        guests,
        name: name.trim(),
        createdAt: new Date().toISOString(),
      }).catch(() => {
        // Best effort: a full or unwritable store must not turn a
        // successfully filed reservation into an error.
      });
    }
    setDone(true);
  }

  const close = (): void => {
    setDone(false);
    setError(null);
    setDate("");
    setTime("");
    setPicker(null);
    onClose();
  };

  const options: { label: string; value: string }[] =
    picker === "time" ? times.map((x) => ({ label: x, value: x })) : [];

  const choose = (value: string): void => {
    if (picker === "date") {
      setDate(value);
      setTime(""); // a new day has its own windows
    } else if (picker === "time") setTime(value);
    setPicker(null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      {/* Tap-away closes; the panel swallows its own touches. */}
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>{t.reserveTitle}</Text>
              <Pressable onPress={close} hitSlop={10}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            {done ? (
              <View style={styles.doneBox}>
                <Text style={styles.doneTick}>✓</Text>
                <Text style={styles.doneTitle}>{t.resDoneTitle}</Text>
                <Text style={styles.doneMeta}>
                  {dateLabel(date)} · {time} · {guests} {guests === 1 ? t.guest : t.guests}
                </Text>
                <Text style={styles.doneSub}>{t.resDoneSub}</Text>
                <Text style={styles.doneWhere}>{t.resDoneWhere}</Text>
                <Pressable style={[styles.cta, styles.ctaStretch]} onPress={close}>
                  <Text style={styles.ctaText}>{t.resDoneBtn}</Text>
                </Pressable>
              </View>
            ) : slots.length === 0 ? (
              <View style={styles.doneBox}>
                <Text style={styles.doneSub}>{t.resNoSlots}</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
                <Text style={styles.lead}>{t.reserveLead}</Text>
                <RequiredLegend />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Picker
                    label={t.resDate}
                    value={date ? dateLabel(date) : "—"}
                    onPress={() => setPicker("date")}
                    style={{ flex: 1 }}
                    required
                  />
                  <Picker
                    label={t.resTime}
                    value={time || "—"}
                    onPress={() => date && setPicker("time")}
                    dim={!date}
                    style={{ flex: 1 }}
                    required
                  />
                </View>
                {/* Party size: plus / minus, one tap per guest (1–20, the
                    server's bounds), instead of a list to scroll. */}
                <View style={{ gap: 4 }}>
                  <Text style={styles.fieldLabel}>{t.resGuests}</Text>
                  <View style={styles.guestsRow}>
                    <Text style={styles.guestsValue}>
                      {guests} {guests === 1 ? t.guest : t.guests}
                    </Text>
                    <QtyStepper
                      quantity={guests}
                      onChange={(next) => setGuests(Math.min(20, Math.max(1, next)))}
                    />
                  </View>
                </View>

                <Field
                  label={t.name}
                  value={name}
                  onChange={setName}
                  placeholder={t.namePlaceholder}
                  required
                />
                <Field
                  label={t.phone}
                  value={phone}
                  onChange={setPhone}
                  placeholder="+49 …"
                  keyboardType="phone-pad"
                  required
                />
                <Field
                  label={t.resNote}
                  value={note}
                  onChange={setNote}
                  placeholder={t.resNotePlaceholder}
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  style={[styles.cta, (missing || busy) && { opacity: 0.5 }]}
                  onPress={() => void submit()}
                  disabled={missing || busy}
                >
                  <Text style={styles.ctaText}>{busy ? t.resSending : t.resSubmit}</Text>
                </Pressable>
                <Text style={styles.footnote}>{t.resFootnote}</Text>
              </ScrollView>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

      {/* Date = calendar, time = option list (the cart's picker pattern). */}
      <Modal visible={picker !== null} transparent animationType="fade">
        <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)}>
          {/* The sheet swallows its own touches, or tapping a day would
              also hit the backdrop and close the picker. */}
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <ScrollView style={{ maxHeight: 460 }}>
              {picker === "date" ? (
                <ReserveCalendar
                  dates={slots.map((s) => s.date)}
                  value={date}
                  tag={localeTag(lang)}
                  onSelect={choose}
                />
              ) : (
                options.map((o) => {
                  const selected = o.value === time;
                  return (
                    <Pressable
                      key={o.value}
                      onPress={() => choose(o.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.option, selected && styles.optionActive]}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                        {o.label}
                      </Text>
                      {selected ? <Text style={{ color: colors.red }}>✓</Text> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

/**
 * The date grid: the leading month and the next one, stacked and
 * scrollable, Monday first. Days the venue cannot seat — closed, past,
 * or past the booking horizon — are present but disabled, so the guest
 * reads the venue's week off the calendar instead of a list that simply
 * omits Mondays.
 *
 * `dates` is already the server's own answer (`reservationSlots`), so
 * "available" here needs no opening-hours maths in the app.
 */
function ReserveCalendar({
  dates,
  value,
  tag,
  onSelect,
}: {
  dates: readonly string[];
  value: string;
  /** BCP-47 tag for the month and weekday names. */
  tag: string;
  onSelect: (date: string) => void;
}): React.ReactElement {
  const months = useMemo(() => reservationMonths(dates), [dates]);
  const weekdays = useMemo(() => weekdayNames(tag, "narrow"), [tag]);
  const dayName = (iso: string): string => {
    const at = new Date(`${iso}T12:00:00Z`);
    try {
      return at.toLocaleDateString(tag, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      });
    } catch {
      return iso;
    }
  };

  return (
    <View style={{ gap: 14, paddingHorizontal: 4, paddingBottom: 6 }}>
      {months.map((month) => (
        <View key={month.key} style={{ gap: 4 }}>
          <Text style={styles.calMonth}>{monthTitle(month.at, tag)}</Text>
          <View style={styles.calRow}>
            {weekdays.map((name, i) => (
              <Text key={i} style={styles.calWeekday}>
                {name}
              </Text>
            ))}
          </View>
          {month.weeks.map((week, w) => (
            <View key={w} style={styles.calRow}>
              {week.map((cell, d) =>
                cell.date === null ? (
                  <View key={`${w}-${d}`} style={styles.calCell} />
                ) : (
                  <Pressable
                    key={cell.date}
                    disabled={!cell.available}
                    onPress={() => onSelect(cell.date as string)}
                    accessibilityRole="button"
                    accessibilityLabel={dayName(cell.date)}
                    accessibilityState={{
                      selected: cell.date === value,
                      disabled: !cell.available,
                    }}
                    style={styles.calCell}
                  >
                    {/* The plate sits inside the 44pt target with a 2pt
                        inset, so adjacent bookable days read as separate
                        keys rather than one solid block. */}
                    <View
                      style={[
                        styles.calPlate,
                        cell.available && styles.calPlateFree,
                        cell.date === value && styles.calPlateOn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.calDay,
                          !cell.available && styles.calDayOff,
                          cell.date === value && styles.calDayOn,
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </View>
                  </Pressable>
                ),
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Picker({
  label,
  value,
  onPress,
  dim,
  style,
  required = false,
}: {
  label: string;
  value: string;
  onPress: () => void;
  dim?: boolean;
  style?: object;
  required?: boolean;
}): React.ReactElement {
  return (
    <View style={[{ gap: 4 }, style]}>
      <FieldLabel label={label} required={required} style={styles.fieldLabel} />
      <Pressable style={[styles.dropdown, dim && { opacity: 0.5 }]} onPress={onPress}>
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "phone-pad";
  /** Set only where `missing` above blocks the request on this field. */
  required?: boolean;
}): React.ReactElement {
  return (
    <View style={{ gap: 4 }}>
      <FieldLabel label={label} required={required} style={styles.fieldLabel} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheetWrap: { maxHeight: "92%" },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.ink, ...fonts.display, fontSize: 22 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  lead: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  fieldLabel: { color: colors.inkSoft, fontSize: 12, ...fonts.bodySemi },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dropdownValue: { color: colors.ink, ...fonts.body, fontSize: 15 },
  chevron: { color: colors.inkSoft, fontSize: 14 },
  input: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.ink,
    ...fonts.body,
    fontSize: 15,
  },
  cta: {
    backgroundColor: colors.red,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  ctaText: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 15 },
  /** doneBox centres its children, which shrinks a width-less Pressable
   *  to its label — stretch the confirmation button back to full width. */
  ctaStretch: { alignSelf: "stretch", marginTop: 14 },
  footnote: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 11,
    textAlign: "center",
  },
  error: { color: colors.danger, ...fonts.bodySemi, fontSize: 13, textAlign: "center" },
  doneBox: { alignItems: "center", gap: 8, paddingVertical: 22 },
  doneTick: { color: colors.red, fontSize: 40 },
  doneTitle: { color: colors.ink, ...fonts.display, fontSize: 20 },
  doneMeta: { color: colors.ink, ...fonts.bodySemi, fontSize: 14 },
  doneSub: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  /** Where to look afterwards — quieter than the confirmation itself. */
  doneWhere: {
    color: colors.ink,
    ...fonts.bodySemi,
    fontSize: 12.5,
    textAlign: "center",
    paddingHorizontal: 12,
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
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  optionActive: { backgroundColor: "#fdeee6" },
  optionText: { color: colors.ink, ...fonts.body, fontSize: 15 },
  optionTextActive: { color: colors.red, ...fonts.bodyHeavy },
  guestsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.creamCard,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  guestsValue: { color: colors.ink, fontSize: 15, ...fonts.bodyBold },

  /* Calendar. Seven equal columns; 44pt tall cells so a day stays a
     comfortable target even on a 360pt-wide phone, where each column is
     about 42pt across. */
  calMonth: {
    color: colors.ink,
    ...fonts.bodyBold,
    fontSize: 15,
    textAlign: "center",
    textTransform: "capitalize",
    paddingBottom: 2,
  },
  calRow: { flexDirection: "row" },
  calWeekday: {
    width: "14.2857%",
    textAlign: "center",
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase",
    paddingVertical: 4,
  },
  calCell: { width: "14.2857%", height: 44, padding: 2 },
  calPlate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  /** A bookable day carries a faint plate so the closed ones read as
   *  gaps in the month rather than as text of a different colour. */
  calPlateFree: { backgroundColor: colors.creamCard },
  calPlateOn: { backgroundColor: colors.red },
  calDay: { color: colors.ink, ...fonts.body, fontSize: 14 },
  calDayOff: { color: colors.inkSoft, opacity: 0.4 },
  calDayOn: { color: colors.onRed, ...fonts.bodyHeavy },
});

/**
 * "Book a table" mark: a laid place setting — plate with fork and knife.
 *
 * Drawn rather than picked from the emoji set. A calendar reads as a
 * date, a chair as furniture, and no emoji shows a table with guests
 * around it; the place setting is the glyph reservation apps use and
 * the one diners recognise instantly as a table held for them.
 */
export function TableForGuestsIcon({
  size = 30,
  color = colors.red,
}: {
  size?: number;
  color?: string;
}): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {/* plate */}
      <Circle cx="16.5" cy="16" r="6.9" fill="none" stroke={color} strokeWidth="2.1" />
      <Circle cx="16.5" cy="16" r="3.1" fill={color} opacity={0.3} />
      {/* fork: three tines over a shaft */}
      <Path
        d="M2.6 6 V11 M5 6 V11 M7.4 6 V11 M5 11 V26"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />
      {/* knife: blade tapering into the handle */}
      <Path
        d="M28 6 C30.4 9.2 30.4 12.8 28 15.6 M28 15.6 V26"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
