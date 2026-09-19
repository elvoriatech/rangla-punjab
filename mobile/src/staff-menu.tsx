import React, { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ApiCategory } from "./api";
import type { StaffItem, StaffItemPatch, StaffMenuCategory, StaffOfferWeekly } from "./staff";
import { localeTag, useI18n } from "./i18n";
import { colors, fonts, money, radius } from "./theme";
import { SHEET_MAX } from "./layout";

/**
 * The owner's side of the menu: one row per dish with the two things a
 * service actually changes on the floor — "we're out of that" and
 * "today this is €2 off" — and nothing else. Dish text, photos and
 * categories stay in the dashboard, which is what the pencil's hint says.
 *
 * Every edit here is LIVE. The screen therefore refetches the guest menu
 * after each accepted change rather than leaving the two views to drift.
 */

/** A guest menu category rendered as the owner's, for the case where the
 *  staff route is unreachable: the owner still sees the card, and the
 *  controls fail honestly instead of the screen being empty. */
export function staffViewOfGuestMenu(categories: ApiCategory[]): StaffMenuCategory[] {
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: c.items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      // The guest payload prices the dish as the guest pays it, so an
      // active offer means `priceCents` is ALREADY the reduced one and
      // the regular price is the offer's `basePriceCents`.
      priceCents: i.offer ? i.offer.basePriceCents : i.priceCents,
      currency: i.currency,
      isAvailable: i.isAvailable,
      photoUrl: i.photoUrl,
      offer: i.offer
        ? { priceCents: i.priceCents, startsAt: null, endsAt: i.offer.endsAt, weekly: null }
        : null,
      offerActive: Boolean(i.offer),
      sourceItemId: null,
    })),
  }));
}

/** What the guest is charged for this dish right now. */
function effectivePrice(item: StaffItem): number {
  return item.offerActive && item.offer ? item.offer.priceCents : item.priceCents;
}

export function StaffDishRow({
  item,
  busy,
  onEdit,
  onToggle,
}: {
  item: StaffItem;
  /** A toggle is in flight — the switch is the thing waiting, so it is
   *  the thing that goes quiet. */
  busy?: boolean;
  onEdit: (item: StaffItem) => void;
  onToggle: (item: StaffItem, next: boolean) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const off = !item.isAvailable;
  return (
    <View style={styles.row}>
      <View style={[styles.rowBody, off && styles.dim]}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photo} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            {off ? (
              <View style={styles.offTag}>
                <Text style={styles.offTagText}>{t.staffOffTag}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.descBox}>
            {item.description ? (
              <Text style={styles.desc} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <View style={styles.priceRow}>
            {item.offerActive ? (
              <>
                <View style={styles.offerBadge}>
                  <Text style={styles.offerBadgeText}>{t.offer}</Text>
                </View>
                <Text style={styles.basePrice}>{money(item.priceCents, item.currency)}</Text>
              </>
            ) : null}
            <Text style={styles.price}>{money(effectivePrice(item), item.currency)}</Text>
          </View>
        </View>
      </View>

      {/* The owner's two controls, at the END of the row where the
          guest's "+" sits. Outside the dimmed body: a sold-out dish is
          exactly when its switch has to be legible. */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => onEdit(item)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${t.staffEditDish} — ${item.name}`}
          style={({ pressed }) => [styles.pencil, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="pencil" size={17} color={colors.red} />
        </Pressable>
        <Switch
          value={item.isAvailable}
          onValueChange={(next) => onToggle(item, next)}
          disabled={busy}
          accessibilityLabel={`${t.staffAvailable} — ${item.name}`}
          trackColor={{ false: colors.line, true: colors.red }}
          thumbColor={colors.cream}
        />
      </View>
    </View>
  );
}

/** The server's limits on a dish's text (`PATCH /api/v1/staff/items/{id}`),
 *  mirrored so a long name is refused next to the input that typed it. */
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

/** "9,50" / "9.50" → 950. Null when it isn't a price at all. */
export function parsePrice(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function formatPrice(cents: number, decimal: string): string {
  return (cents / 100).toFixed(2).replace(".", decimal);
}

/** "YYYY-MM-DD" in the DEVICE's own timezone (not UTC — an evening in
 *  Berlin must not offer yesterday's date). */
function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function sameWeekly(a: StaffOfferWeekly | null, b: StaffOfferWeekly | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.days.length === b.days.length &&
    [...a.days].sort().join() === [...b.days].sort().join()
  );
}

/**
 * Edit one dish.
 *
 * The name is read-only on purpose: translations, description, allergens
 * and photo are a desk job, and a phone-sized text field is how menus
 * end up with half-translated dishes. Price, availability and the offer
 * are the three things the floor changes mid-service.
 */
export function StaffItemSheet({
  item,
  onClose,
  onSave,
}: {
  item: StaffItem | null;
  onClose: () => void;
  /** Resolves to the field the server rejected ("" = a general failure,
   *  null = saved). The sheet stays open on anything but null. */
  onSave: (item: StaffItem, patch: StaffItemPatch) => Promise<string | null>;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const decimal = lang === "en" ? "." : ",";

  // Everything is keyed off the item's id: opening a different dish
  // remounts the form, so no state can leak from one dish to the next.
  return (
    <Modal visible={item !== null} animationType="slide" transparent onRequestClose={onClose}>
      {item ? (
        <StaffItemForm
          key={item.id}
          item={item}
          decimal={decimal}
          tag={localeTag(lang)}
          t={t}
          onClose={onClose}
          onSave={onSave}
        />
      ) : (
        <View />
      )}
    </Modal>
  );
}

function StaffItemForm({
  item,
  decimal,
  tag,
  t,
  onClose,
  onSave,
}: {
  item: StaffItem;
  decimal: string;
  tag: string;
  t: ReturnType<typeof useI18n>["t"];
  onClose: () => void;
  onSave: (item: StaffItem, patch: StaffItemPatch) => Promise<string | null>;
}): React.ReactElement {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [price, setPrice] = useState(formatPrice(item.priceCents, decimal));
  const [available, setAvailable] = useState(item.isAvailable);
  const [offerOn, setOfferOn] = useState(item.offer !== null);
  const [offerPrice, setOfferPrice] = useState(
    item.offer ? formatPrice(item.offer.priceCents, decimal) : "",
  );
  /** "" = open-ended. Seeded from the offer's own end, read in the
   *  device's timezone (the only clock this screen has). */
  const [endDate, setEndDate] = useState(() => {
    if (!item.offer?.endsAt) return "";
    const d = new Date(item.offer.endsAt);
    return Number.isNaN(d.getTime()) ? "" : isoDate(d);
  });
  const [endTime, setEndTime] = useState(() => {
    if (!item.offer?.endsAt) return "";
    const d = new Date(item.offer.endsAt);
    if (Number.isNaN(d.getTime())) return "";
    const h = `${d.getHours()}`.padStart(2, "0");
    // Snap onto the 15-minute grid the picker offers.
    const m = `${Math.floor(d.getMinutes() / 15) * 15}`.padStart(2, "0");
    return `${h}:${m}`;
  });
  const [days, setDays] = useState<number[]>(item.offer?.weekly?.days ?? []);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    field: "name" | "description" | "price" | "offer" | "general";
    text: string;
  } | null>(null);

  const dates = useMemo(() => {
    const out: { label: string; value: string }[] = [{ label: t.staffOfferOpenEnd, value: "" }];
    const today = new Date();
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      out.push({
        label: d.toLocaleDateString(tag, { weekday: "short", day: "2-digit", month: "2-digit" }),
        value: isoDate(d),
      });
    }
    return out;
  }, [t.staffOfferOpenEnd, tag]);

  const times = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const label = `${`${Math.floor(minutes / 60)}`.padStart(2, "0")}:${`${minutes % 60}`.padStart(2, "0")}`;
      out.push({ label, value: label });
    }
    return out;
  }, []);

  const toggleDay = (index: number): void => {
    setDays((current) =>
      current.includes(index) ? current.filter((d) => d !== index) : [...current, index].sort(),
    );
  };

  async function save(): Promise<void> {
    if (busy) return;
    const trimmedName = name.trim();
    // The server's own limits, checked here so the message lands under
    // the input that caused it rather than arriving as a bare 400.
    if (trimmedName.length === 0 || trimmedName.length > NAME_MAX) {
      setError({ field: "name", text: t.staffNameInvalid });
      return;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription.length > DESCRIPTION_MAX) {
      setError({ field: "description", text: t.staffDescriptionInvalid });
      return;
    }
    const cents = parsePrice(price);
    if (cents === null) {
      setError({ field: "price", text: t.staffPriceInvalid });
      return;
    }
    let offer: StaffItemPatch["offer"] | undefined;
    if (offerOn) {
      const offerCents = parsePrice(offerPrice);
      if (offerCents === null) {
        setError({ field: "offer", text: t.staffPriceInvalid });
        return;
      }
      // The server enforces this too (and the DB has a CHECK) — saying it
      // here just saves a round trip and names the right field.
      if (offerCents >= cents) {
        setError({ field: "offer", text: t.staffOfferTooHigh });
        return;
      }
      const endsAt = endDate ? new Date(`${endDate}T${endTime || "23:59"}:00`).toISOString() : null;
      const weekly: StaffOfferWeekly | null =
        days.length > 0
          ? {
              days,
              // A window the owner never set means the whole day; one the
              // dashboard DID set is preserved rather than flattened.
              start: item.offer?.weekly?.start ?? "00:00",
              end: item.offer?.weekly?.end ?? "23:59",
            }
          : null;
      const same =
        item.offer !== null &&
        item.offer.priceCents === offerCents &&
        item.offer.endsAt === endsAt &&
        sameWeekly(item.offer.weekly, weekly);
      if (!same) {
        offer = { priceCents: offerCents, startsAt: item.offer?.startsAt ?? null, endsAt, weekly };
      }
    } else if (item.offer !== null) {
      offer = null;
    }

    const patch: StaffItemPatch = {
      ...(trimmedName === item.name ? {} : { name: trimmedName }),
      // An emptied description clears it; unchanged means unsent, so a
      // dish that never had one is not "cleared" on every save.
      ...(trimmedDescription === (item.description ?? "")
        ? {}
        : { description: trimmedDescription.length > 0 ? trimmedDescription : null }),
      ...(cents === item.priceCents ? {} : { priceCents: cents }),
      ...(available === item.isAvailable ? {} : { isAvailable: available }),
      ...(offer === undefined ? {} : { offer }),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    const failedField = await onSave(item, patch);
    setBusy(false);
    if (failedField === null) {
      onClose();
      return;
    }
    // The server names the path it refused ("name", "description",
    // "offer.priceCents", "priceCents", "offer.endsAt", …) — point at
    // that control when it is one of the inputs, and fall back to the
    // sheet's own line. Order matters: "offer.priceCents" must not be
    // read as the dish's own price.
    const field = /^offer\.(starts|ends)At/i.test(failedField)
      ? "general"
      : /offer/i.test(failedField)
        ? "offer"
        : /^name$/i.test(failedField)
          ? "name"
          : /^description$/i.test(failedField)
            ? "description"
            : /price/i.test(failedField)
              ? "price"
              : "general";
    setError({
      field,
      text: failedField ? `${t.staffSaveFailed} (${failedField})` : t.staffSaveFailed,
    });
  }

  const options = picker === "date" ? dates : picker === "time" ? times : [];
  const dateLabel = endDate
    ? (dates.find((d) => d.value === endDate)?.label ?? endDate)
    : t.staffOfferOpenEnd;
  const weeklyWindow = item.offer?.weekly;
  const windowNote =
    weeklyWindow && (weeklyWindow.start !== "00:00" || weeklyWindow.end !== "23:59")
      ? `${weeklyWindow.start}–${weeklyWindow.end}`
      : null;

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t.staffEditDish}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
              {/* Name and description used to be read-only here, with a
                  line pointing at the web dashboard. The counter is the
                  device the owner actually has in their hand, so they
                  are edited in place. */}
              <View style={{ gap: 4 }}>
                <Text style={styles.label}>{t.staffItemName}</Text>
                <TextInput
                  value={name}
                  onChangeText={(next) => {
                    setName(next);
                    setError(null);
                  }}
                  maxLength={NAME_MAX}
                  autoCapitalize="sentences"
                  style={[styles.input, error?.field === "name" && styles.inputBad]}
                  accessibilityLabel={t.staffItemName}
                />
                {error?.field === "name" ? <Text style={styles.error}>{error.text}</Text> : null}
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.label}>{t.staffItemDescription}</Text>
                <TextInput
                  value={description}
                  onChangeText={(next) => {
                    setDescription(next);
                    setError(null);
                  }}
                  maxLength={DESCRIPTION_MAX}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  autoCapitalize="sentences"
                  style={[
                    styles.input,
                    styles.inputMultiline,
                    error?.field === "description" && styles.inputBad,
                  ]}
                  accessibilityLabel={t.staffItemDescription}
                />
                <Text style={styles.hint}>{t.staffItemDescriptionHint}</Text>
                {error?.field === "description" ? (
                  <Text style={styles.error}>{error.text}</Text>
                ) : null}
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.label}>{t.staffPrice}</Text>
                <TextInput
                  value={price}
                  onChangeText={(next) => {
                    setPrice(next);
                    setError(null);
                  }}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  style={[styles.input, error?.field === "price" && styles.inputBad]}
                  accessibilityLabel={t.staffPrice}
                />
                {error?.field === "price" ? <Text style={styles.error}>{error.text}</Text> : null}
              </View>

              <SwitchRow
                label={t.staffAvailable}
                value={available}
                onChange={(next) => setAvailable(next)}
              />

              <View style={styles.offerBox}>
                <SwitchRow
                  label={t.staffOfferOn}
                  value={offerOn}
                  onChange={(next) => {
                    setOfferOn(next);
                    setError(null);
                  }}
                />
                {offerOn ? (
                  <View style={{ gap: 12, marginTop: 4 }}>
                    <View style={{ gap: 4 }}>
                      <Text style={styles.label}>{t.staffOfferPrice}</Text>
                      <TextInput
                        value={offerPrice}
                        onChangeText={(next) => {
                          setOfferPrice(next);
                          setError(null);
                        }}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        placeholder={formatPrice(Math.max(0, item.priceCents - 100), decimal)}
                        placeholderTextColor={colors.inkSoft}
                        style={[styles.input, error?.field === "offer" && styles.inputBad]}
                        accessibilityLabel={t.staffOfferPrice}
                      />
                      {error?.field === "offer" ? (
                        <Text style={styles.error}>{error.text}</Text>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <PickerField
                        label={t.staffOfferUntilDate}
                        value={dateLabel}
                        onPress={() => setPicker("date")}
                        style={{ flex: 1 }}
                      />
                      <PickerField
                        label={t.staffOfferUntilTime}
                        value={endTime || "—"}
                        onPress={() => endDate && setPicker("time")}
                        dim={!endDate}
                        style={{ flex: 1 }}
                      />
                    </View>

                    <View style={{ gap: 6 }}>
                      <Text style={styles.label}>
                        {t.staffOfferDays}
                        {windowNote ? ` · ${windowNote}` : ""}
                      </Text>
                      <View style={styles.dayRow}>
                        {t.daysShort.map((label, index) => {
                          const on = days.includes(index);
                          return (
                            <Pressable
                              key={label}
                              onPress={() => toggleDay(index)}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={t.days[index]}
                              style={[styles.dayChip, on && styles.dayChipOn]}
                            >
                              <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={styles.hint}>{t.staffOfferAllDay}</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {error?.field === "general" ? <Text style={styles.error}>{error.text}</Text> : null}
              <Text style={styles.hint}>{t.staffMenuLive}</Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  style={[styles.btn, styles.btnQuiet]}
                  onPress={onClose}
                  accessibilityRole="button"
                >
                  <Text style={styles.btnQuietText}>{t.staffCancel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]}
                  onPress={() => void save()}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  <Text style={styles.btnPrimaryText}>{busy ? t.staffSaving : t.staffSave}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

      {/* Same option list the reservation sheet uses. */}
      <Modal visible={picker !== null} transparent animationType="fade">
        <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)}>
          <View style={styles.pickerSheet}>
            <ScrollView style={{ maxHeight: 400 }}>
              {options.map((o) => {
                const selected =
                  picker === "date"
                    ? o.value === endDate
                    : picker === "time" && o.value === endTime;
                return (
                  <Pressable
                    key={`${picker}-${o.value}`}
                    onPress={() => {
                      if (picker === "date") {
                        setEndDate(o.value);
                        if (!o.value) setEndTime("");
                      } else setEndTime(o.value);
                      setPicker(null);
                    }}
                    style={[styles.option, selected && styles.optionActive]}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                      {o.label}
                    </Text>
                    {selected ? <Text style={{ color: colors.red }}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.line, true: colors.red }}
        thumbColor={colors.cream}
      />
    </View>
  );
}

function PickerField({
  label,
  value,
  onPress,
  dim,
  style,
}: {
  label: string;
  value: string;
  onPress: () => void;
  dim?: boolean;
  style?: object;
}): React.ReactElement {
  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.dropdown, dim && { opacity: 0.5 }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.creamCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
    height: 106,
    overflow: "hidden",
  },
  rowBody: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  /** A dish that is off is still readable, just plainly not on sale. */
  dim: { opacity: 0.45 },
  photo: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.line },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, color: colors.ink, fontSize: 15.5, lineHeight: 20, ...fonts.bodyBold },
  offTag: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.cream,
  },
  offTagText: { color: colors.inkSoft, fontSize: 9, ...fonts.bodyHeavy, letterSpacing: 0.5 },
  descBox: { height: 36, justifyContent: "flex-start" },
  desc: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 18 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  price: { color: colors.red, fontSize: 14, ...fonts.bodyBold },
  basePrice: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  offerBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  offerBadgeText: { color: colors.ink, fontSize: 8, ...fonts.bodyHeavy, letterSpacing: 0.5 },
  controls: { alignItems: "center", gap: 10 },
  pencil: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.red,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },

  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheetWrap: { maxHeight: "92%" },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
    // A dish form stretched across a tablet is unreadable; capped and
    // centred it stays the same shape it has on a phone.
    width: "100%",
    maxWidth: SHEET_MAX,
    alignSelf: "center",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sheetTitle: { color: colors.ink, ...fonts.display, fontSize: 22 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  label: { color: colors.inkSoft, fontSize: 12, ...fonts.bodySemi },
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
  inputBad: { borderColor: colors.danger },
  /** Three lines of room, growing with the text — a dish description is
   *  a sentence or two, not a single-line field to scroll sideways. */
  inputMultiline: { minHeight: 88, paddingTop: 11 },
  error: { color: colors.danger, ...fonts.bodySemi, fontSize: 12.5 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  switchLabel: { color: colors.ink, ...fonts.bodyBold, fontSize: 15 },
  offerBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.creamCard,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: {
    // WCAG's 44pt target: seven of these sit side by side, so the one
    // place the layout would happily shrink is the one that can't.
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream,
  },
  dayChipOn: { backgroundColor: colors.red, borderColor: colors.red },
  dayChipText: { color: colors.ink, ...fonts.bodySemi, fontSize: 12.5 },
  dayChipTextOn: { color: colors.onRed, ...fonts.bodyBold },
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
  btn: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  btnPrimary: { backgroundColor: colors.red },
  btnPrimaryText: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 15 },
  btnQuiet: { borderWidth: 1, borderColor: colors.red, backgroundColor: "transparent" },
  btnQuietText: { color: colors.red, ...fonts.bodyBold, fontSize: 15 },
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
});
