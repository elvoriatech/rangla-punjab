import React, { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RequiredLegend } from "./components";
import type { ApiMenu } from "./api";
import { BASE_URL, createCateringRequest } from "./api";
import { localeTag, useI18n } from "./i18n";
import { Field, Picker, ReserveCalendar, sheetStyles as s } from "./reserve-sheet";
import { colors, fonts, radius } from "./theme";

/**
 * Catering — "cook for our party" (owner, 2026-09-29).
 *
 * The same sheet as "Reserve a table", on purpose: a guest who has booked
 * a table already knows how this one works. What differs is the owner's
 * rules for catering —
 *
 * - the date runs from TOMORROW to four months out, on a calendar that
 *   offers every day (catering is cooked for an event, so the venue's
 *   opening hours are not the grid);
 * - the time is optional ("we'll sort it out on the phone" is normal);
 * - any number of guests, typed rather than stepped — nobody taps "+"
 *   eighty times;
 * - a phone number is required (contact is the whole point of the lead),
 *   email, the event's venue and a free-text message are optional.
 *
 * The server re-checks the window against the venue's own timezone and
 * answers `invalid_date` if the device's clock disagreed.
 *
 * The poster on top is the venue's catering banner, served from the site
 * beside the home-slider posters (the gift-card screen's pattern), so the
 * owner replaces the artwork by replacing the file. Until that file exists
 * the image simply fails and the sheet starts at its title.
 */

const CATERING_BANNER = `${BASE_URL}/app-slider/catering-de.webp`;

/** Calendar months to stack: tomorrow … four months on can touch five. */
const CALENDAR_MONTHS = 5;
const MONTHS_AHEAD = 4;

/** Half-hour steps across a working day — an event time, not a slot. */
const TIMES = Array.from({ length: 29 }, (_, i) => {
  const minutes = 9 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
});

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every date from tomorrow to four calendar months after today (the day
 *  clamped to the target month's length), in the device's own calendar. */
export function cateringDates(now = new Date()): string[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const targetMonth = now.getMonth() + MONTHS_AHEAD;
  const lastDay = Math.min(
    now.getDate(),
    new Date(now.getFullYear(), targetMonth + 1, 0).getDate(),
  );
  const end = new Date(now.getFullYear(), targetMonth, lastDay);
  const out: string[] = [];
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(iso(d));
  }
  return out;
}

export function CateringSheet({
  menu,
  visible,
  onClose,
}: {
  menu: ApiMenu;
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const dates = useMemo(() => (visible ? cateringDates() : []), [visible]);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [bannerOk, setBannerOk] = useState(true);

  const guestCount = Number(guests);
  const missing =
    !date ||
    !Number.isInteger(guestCount) ||
    guestCount < 1 ||
    name.trim().length < 2 ||
    phone.trim().length < 5;

  const dateLabel = (value: string): string =>
    new Date(`${value}T12:00:00`).toLocaleDateString(localeTag(lang), {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  async function submit(): Promise<void> {
    if (busy || missing) return;
    setBusy(true);
    setError(null);
    const result = await createCateringRequest({
      slug: menu.venue.slug,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      guests: guestCount,
      date,
      time: time || undefined,
      location: location.trim() || undefined,
      message: message.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(
        result.error === "invalid_date"
          ? t.cateringDateGone
          : result.error === "rate_limited"
            ? t.resTooMany
            : t.cateringFailed,
      );
      return;
    }
    setDone(true);
  }

  const close = (): void => {
    // A sent request clears the form; a half-filled one is kept, so a
    // guest who closes the sheet to check a date doesn't retype it all.
    if (done) {
      setDate("");
      setTime("");
      setGuests("");
      setLocation("");
      setMessage("");
    }
    setDone(false);
    setError(null);
    setPicker(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.sheetWrap}
        >
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.header}>
              <Text style={s.title}>👨‍🍳 {t.cateringTitle}</Text>
              <Pressable onPress={close} hitSlop={10} accessibilityLabel={t.close}>
                <Text style={s.close}>×</Text>
              </Pressable>
            </View>

            {done ? (
              <View style={s.doneBox}>
                <Text style={s.doneTick}>✓</Text>
                <Text style={s.doneTitle}>{t.cateringDoneTitle}</Text>
                <Text style={s.doneMeta}>
                  {dateLabel(date)}
                  {time ? ` · ${time}` : ""} · {guestCount} {guestCount === 1 ? t.guest : t.guests}
                </Text>
                <Text style={s.doneSub}>{t.cateringDoneSub}</Text>
                <Pressable style={[s.cta, s.ctaStretch]} onPress={close}>
                  <Text style={s.ctaText}>{t.resDoneBtn}</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
                keyboardShouldPersistTaps="handled"
              >
                {bannerOk ? (
                  <Image
                    source={{ uri: CATERING_BANNER }}
                    style={styles.banner}
                    resizeMode="cover"
                    onError={() => setBannerOk(false)}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    accessibilityIgnoresInvertColors
                  />
                ) : null}
                <Text style={s.lead}>{t.cateringLead}</Text>
                <RequiredLegend />

                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                  <Picker
                    label={t.cateringDate}
                    value={date ? dateLabel(date) : "—"}
                    onPress={() => setPicker("date")}
                    style={{ flex: 1 }}
                    required
                  />
                  <Picker
                    label={t.cateringTime}
                    value={time || "—"}
                    onPress={() => setPicker("time")}
                    style={{ flex: 1 }}
                  />
                </View>

                <View style={{ gap: 4 }}>
                  <Field
                    label={t.cateringGuests}
                    value={guests}
                    // Digits only, capped at four: the server's guard is
                    // 5000, and no one types a party size past that.
                    onChange={(next) => setGuests(next.replace(/[^0-9]/g, "").slice(0, 4))}
                    placeholder="80"
                    keyboardType="number-pad"
                    required
                  />
                  <Text style={styles.hint}>{t.cateringGuestsHint}</Text>
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
                  label={t.cateringEmail}
                  value={email}
                  onChange={setEmail}
                  placeholder="name@mail.de"
                  keyboardType="email-address"
                />
                <Field
                  label={t.cateringLocation}
                  value={location}
                  onChange={setLocation}
                  placeholder={t.cateringLocationPlaceholder}
                />
                <Field
                  label={t.cateringMessage}
                  value={message}
                  onChange={setMessage}
                  placeholder={t.cateringMessagePlaceholder}
                  multiline
                />

                {error ? <Text style={s.error}>{error}</Text> : null}

                <Pressable
                  style={[s.cta, (missing || busy) && { opacity: 0.5 }]}
                  onPress={() => void submit()}
                  disabled={missing || busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: missing || busy }}
                >
                  <Text style={s.ctaText}>{busy ? t.cateringSending : t.cateringSubmit}</Text>
                </Pressable>
                <Text style={s.footnote}>{t.cateringFootnote}</Text>
              </ScrollView>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

      <Modal visible={picker !== null} transparent animationType="fade">
        <Pressable style={s.pickerBackdrop} onPress={() => setPicker(null)}>
          <Pressable style={s.pickerSheet} onPress={() => {}}>
            <ScrollView style={{ maxHeight: 460 }}>
              {picker === "date" ? (
                <ReserveCalendar
                  dates={dates}
                  value={date}
                  tag={localeTag(lang)}
                  monthCount={CALENDAR_MONTHS}
                  onSelect={(value) => {
                    setDate(value);
                    setPicker(null);
                  }}
                />
              ) : (
                ["", ...TIMES].map((value) => {
                  const selected = value === time;
                  return (
                    <Pressable
                      key={value || "none"}
                      onPress={() => {
                        setTime(value);
                        setPicker(null);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[s.option, selected && s.optionActive]}
                    >
                      <Text style={[s.optionText, selected && s.optionTextActive]}>
                        {value || t.cateringNoTime}
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

const styles = StyleSheet.create({
  /** The venue's 2:1 poster, as on the gift-card screen. */
  banner: {
    width: "100%",
    aspectRatio: 2,
    borderRadius: radius.lg,
    backgroundColor: colors.creamCard,
  },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
});
