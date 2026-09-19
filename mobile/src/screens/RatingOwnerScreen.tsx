import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import { useAuth } from "../auth";
import type { StaffPlace, StaffRating, StaffRatingLookupError } from "../staff";
import {
  fetchStaffRating,
  refreshStaffRating,
  searchStaffRatingPlaces,
  updateStaffRating,
} from "../staff";
import { BrandHeader, OutlineButton, PrimaryButton } from "../components";
import { fill, localeTag, useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, radius } from "../theme";

/**
 * The Google rating, from behind the counter (P7-14).
 *
 * The star line under the restaurant's name is the only piece of its
 * public face an owner can change from the phone, and it has three
 * separate jobs stacked on one screen:
 *
 *   1. SHOW IT OR NOT — one switch, saved the moment it moves.
 *   2. FETCH IT — Place ID + "refresh now". Needs a Google Places API
 *      key on the SERVER, which most deployments of this app will never
 *      have; `canFetch` says so and the section explains itself.
 *   3. TYPE IT — the fallback that actually gets used: the numbers off
 *      the owner's own Google Business profile.
 *
 * Which of (2) and (3) a guest ends up seeing is the SERVER's verdict
 * (`effective.source`), never re-derived here — the same rule the web
 * card follows, and the reason the header shows provenance in words
 * rather than leaving the owner to guess.
 */

/** What a save or a lookup just did, said once above the cards. */
interface Notice {
  tone: "ok" | "bad";
  text: string;
}

/** Google's own limits, mirrored so a typo never reaches the server. */
const MAX_COUNT = 10_000_000;

export function RatingOwnerScreen({
  venueName,
  onBack,
  onOpenOwnerMenu,
}: {
  /** Seeds the "find my Place ID" box — searching for your own
   *  restaurant by name is what the button is for. */
  venueName: string;
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const tag = localeTag(lang);

  const [rating, setRating] = useState<StaffRating | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Which input the server (or this screen) rejected. */
  const [badField, setBadField] = useState<"value" | "count" | "placeId" | null>(null);

  const [placeId, setPlaceId] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState(venueName);
  const [places, setPlaces] = useState<StaffPlace[] | null>(null);
  const [value, setValue] = useState("");
  const [count, setCount] = useState("");

  const [busy, setBusy] = useState<"place" | "search" | "refresh" | "manual" | "clear" | null>(
    null,
  );

  /** Every route fails in the same two vocabularies; this turns either
   *  into one sentence the owner can act on. */
  const say = useCallback(
    (error: string, reason?: StaffRatingLookupError): void => {
      if (error === "unauthorized") {
        clearStaff();
        return;
      }
      const errors = t.ratingOwnerErrors;
      if (reason) {
        setNotice({ tone: "bad", text: errors[reason] });
        return;
      }
      setNotice({
        tone: "bad",
        text: error === "network" ? errors.network : t.ratingOwnerSaveFailed,
      });
    },
    [clearStaff, t],
  );

  /** One place where the server's answer becomes the screen: the inputs
   *  follow the saved state, so a rejected edit never lingers. */
  const adopt = useCallback((next: StaffRating): void => {
    setRating(next);
    setPlaceId(next.placeId ?? "");
    setValue(next.manual ? next.manual.value.toFixed(1) : "");
    setCount(next.manual ? String(next.manual.count) : "");
    setBadField(null);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffRating(staffToken);
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

  const patch = useCallback(
    async (
      body: Parameters<typeof updateStaffRating>[1],
      okText: string | null,
      job: Exclude<typeof busy, null>,
    ): Promise<void> => {
      if (!staffToken) return;
      setBusy(job);
      setNotice(null);
      const res = await updateStaffRating(staffToken, body);
      setBusy(null);
      if (res.ok) {
        adopt(res.data);
        if (okText) setNotice({ tone: "ok", text: okText });
        return;
      }
      // The server names the input it refused — point at it, and say
      // what it wanted, rather than showing a general failure.
      const field =
        res.field === "value" || res.field === "count" || res.field === "placeId"
          ? res.field
          : null;
      setBadField(field);
      if (res.error === "invalid" && field) {
        setNotice({
          tone: "bad",
          text:
            field === "value"
              ? t.ratingOwnerBadValue
              : field === "count"
                ? t.ratingOwnerBadCount
                : t.ratingOwnerBadPlaceId,
        });
        return;
      }
      say(res.error);
    },
    [staffToken, adopt, say, t],
  );

  // The switch is the one control that saves itself. It moves at once —
  // waiting on a round trip makes a switch feel broken — and the server's
  // answer either confirms it or puts it back.
  const toggle = useCallback(
    (next: boolean): void => {
      if (!rating || !staffToken) return;
      const before = rating;
      setRating({ ...rating, enabled: next });
      setNotice(null);
      void updateStaffRating(staffToken, { enabled: next }).then((res) => {
        if (res.ok) {
          adopt(res.data);
          return;
        }
        setRating(before);
        say(res.error);
      });
    },
    [rating, staffToken, adopt, say],
  );

  const search = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const q = query.trim();
    if (!q) return;
    setBusy("search");
    setNotice(null);
    const res = await searchStaffRatingPlaces(staffToken, q);
    setBusy(null);
    if (res.ok) {
      setPlaces(res.data);
      if (res.data.length === 0) setNotice({ tone: "bad", text: t.ratingOwnerSearchEmpty });
      return;
    }
    setPlaces(null);
    say(res.error, res.reason);
  }, [staffToken, query, say, t]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    setBusy("refresh");
    setNotice(null);
    const res = await refreshStaffRating(staffToken);
    setBusy(null);
    if (res.ok) {
      adopt(res.data);
      setNotice({ tone: "ok", text: t.ratingOwnerRefreshed });
      return;
    }
    say(res.error, res.reason);
  }, [staffToken, adopt, say, t]);

  const saveManual = useCallback((): void => {
    // "4,7" and "4.7" are the same number to an owner; only one of them
    // is a number to JSON.
    const parsed = Number(value.trim().replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
      setBadField("value");
      setNotice({ tone: "bad", text: t.ratingOwnerBadValue });
      return;
    }
    const reviews = Number(count.trim().replace(/[\s.,]/g, ""));
    if (!Number.isInteger(reviews) || reviews < 0 || reviews > MAX_COUNT) {
      setBadField("count");
      setNotice({ tone: "bad", text: t.ratingOwnerBadCount });
      return;
    }
    // One decimal is the whole scale Google works in — round here so the
    // server never has to refuse a third digit.
    const rounded = Math.round(parsed * 10) / 10;
    void patch({ manual: { value: rounded, count: reviews } }, t.ratingOwnerSaved, "manual");
  }, [value, count, patch, t]);

  const savePlaceId = useCallback((): void => {
    const next = placeId.trim();
    void patch({ placeId: next.length > 0 ? next : null }, t.ratingOwnerPlaceIdSaved, "place");
  }, [placeId, patch, t]);

  const usePlace = useCallback(
    (place: StaffPlace): void => {
      setSearchOpen(false);
      setPlaces(null);
      void patch({ placeId: place.id }, t.ratingOwnerPlaceIdSaved, "place");
    },
    [patch, t],
  );

  const number = (n: number): string => n.toLocaleString(tag);
  const score = (n: number): string =>
    n.toLocaleString(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const whenOf = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(tag, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const sourceLine = (r: StaffRating): string => {
    if (!r.effective) return t.ratingOwnerNoneHint;
    if (r.effective.source === "manual") return t.ratingOwnerFromYou;
    const when = whenOf(r.fetched?.fetchedAt ?? null);
    return when ? fill(t.ratingOwnerFromGoogle, { when }) : t.ratingOwnerFromGoogleNew;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.ownerRating} onBack={onBack} onMenu={onOpenOwnerMenu} />
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
          ) : !rating ? (
            <>
              <Text style={styles.bad}>{t.staffLoadFailed}</Text>
              <OutlineButton label={t.issueRetry} onPress={() => void load()} />
            </>
          ) : (
            <>
              {notice ? (
                <Text style={notice.tone === "ok" ? styles.ok : styles.bad}>{notice.text}</Text>
              ) : null}

              {/* What guests see right now, and the switch that decides
                  whether they see it at all. */}
              <View style={styles.card}>
                {rating.effective ? (
                  <View style={styles.scoreRow}>
                    <Text style={styles.star}>★</Text>
                    <Text style={styles.score}>{score(rating.effective.value)}</Text>
                    <Text style={styles.scoreCount}>
                      {fill(t.ratingOwnerReviews, { count: number(rating.effective.count) })}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.scoreNone}>{t.ratingOwnerNone}</Text>
                )}
                <Text style={styles.hint}>{sourceLine(rating)}</Text>
                {rating.effective && !rating.enabled ? (
                  <Text style={styles.warn}>{t.ratingOwnerHidden}</Text>
                ) : null}

                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>{t.ratingOwnerShow}</Text>
                  <Switch
                    value={rating.enabled}
                    onValueChange={toggle}
                    accessibilityLabel={t.ratingOwnerShow}
                    trackColor={{ false: colors.line, true: colors.red }}
                    thumbColor={colors.cream}
                  />
                </View>
                <Text style={styles.hint}>{t.ratingOwnerShowHint}</Text>

                {rating.reviewUrl ? (
                  <Pressable
                    onPress={() => void Linking.openURL(rating.reviewUrl ?? "").catch(() => {})}
                    accessibilityRole="link"
                    accessibilityLabel={t.ratingOwnerReviewLink}
                    style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="open-outline" size={16} color={colors.red} />
                    <Text style={styles.link}>{t.ratingOwnerReviewLink}</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Fetch from Google — the better number when this
                  deployment can reach Google at all. */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t.ratingOwnerFetchTitle}</Text>
                {rating.canFetch ? null : <Text style={styles.warn}>{t.ratingOwnerNoKey}</Text>}

                <View style={{ gap: 4 }}>
                  <Text style={styles.label}>{t.ratingOwnerPlaceId}</Text>
                  <TextInput
                    value={placeId}
                    onChangeText={(next) => {
                      setPlaceId(next);
                      setBadField(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                    placeholderTextColor={colors.inkSoft}
                    style={[styles.input, badField === "placeId" && styles.inputBad]}
                    accessibilityLabel={t.ratingOwnerPlaceId}
                  />
                  <Text style={styles.hint}>{t.ratingOwnerPlaceIdHint}</Text>
                </View>

                <View style={styles.buttonRow}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      label={t.ratingOwnerSave}
                      busyLabel={t.ratingOwnerSaving}
                      busy={busy === "place"}
                      disabled={busy !== null && busy !== "place"}
                      onPress={savePlaceId}
                    />
                  </View>
                  <Pressable
                    onPress={() => {
                      setSearchOpen((open) => !open);
                      setPlaces(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t.ratingOwnerSearchLabel}
                    style={({ pressed }) => [styles.findBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="search" size={16} color={colors.red} />
                    <Text style={styles.findBtnText}>{t.ratingOwnerFind}</Text>
                  </Pressable>
                </View>

                {searchOpen ? (
                  <View style={styles.searchBox}>
                    <Text style={styles.label}>{t.ratingOwnerSearchLabel}</Text>
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={() => void search()}
                      placeholder={t.ratingOwnerSearchPlaceholder}
                      placeholderTextColor={colors.inkSoft}
                      style={styles.input}
                      accessibilityLabel={t.ratingOwnerSearchLabel}
                    />
                    <PrimaryButton
                      label={t.ratingOwnerSearch}
                      busyLabel={t.ratingOwnerSearching}
                      busy={busy === "search"}
                      disabled={busy !== null && busy !== "search"}
                      onPress={() => void search()}
                    />
                    {places?.map((place) => (
                      <Pressable
                        key={place.id}
                        onPress={() => usePlace(place)}
                        accessibilityRole="button"
                        accessibilityLabel={`${t.ratingOwnerUseThis} — ${place.name || t.ratingOwnerUnnamed}`}
                        style={({ pressed }) => [
                          styles.placeRow,
                          pressed && { backgroundColor: colors.cream },
                        ]}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.placeName} numberOfLines={1}>
                            {place.name || t.ratingOwnerUnnamed}
                          </Text>
                          {place.address ? (
                            <Text style={styles.placeAddress} numberOfLines={2}>
                              {place.address}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.placeUse}>{t.ratingOwnerUseThis}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {rating.placeId ? (
                  <View style={{ gap: 6 }}>
                    <OutlineButton
                      label={busy === "refresh" ? t.ratingOwnerRefreshing : t.ratingOwnerRefresh}
                      icon="refresh"
                      onPress={() => {
                        if (busy === null) void refresh();
                      }}
                    />
                    <Text style={styles.hint}>{t.ratingOwnerRefreshHint}</Text>
                  </View>
                ) : null}
              </View>

              {/* Type it in — the path every deployment without a
                  ⛔ human-gated Places API key actually takes. */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t.ratingOwnerManualTitle}</Text>
                <Text style={styles.hint}>{t.ratingOwnerManualHint}</Text>
                {rating.effective?.source === "fetched" ? (
                  <Text style={styles.warn}>{t.ratingOwnerManualBeaten}</Text>
                ) : null}

                <View style={styles.fieldRow}>
                  <View style={styles.field}>
                    <Text style={styles.label}>{t.ratingOwnerValue}</Text>
                    <TextInput
                      value={value}
                      onChangeText={(next) => {
                        setValue(next);
                        setBadField(null);
                      }}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      maxLength={4}
                      placeholder="4.7"
                      placeholderTextColor={colors.inkSoft}
                      style={[styles.input, badField === "value" && styles.inputBad]}
                      accessibilityLabel={t.ratingOwnerValue}
                    />
                    <Text style={styles.hint}>{t.ratingOwnerValueHint}</Text>
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>{t.ratingOwnerCount}</Text>
                    <TextInput
                      value={count}
                      onChangeText={(next) => {
                        setCount(next);
                        setBadField(null);
                      }}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="440"
                      placeholderTextColor={colors.inkSoft}
                      style={[styles.input, badField === "count" && styles.inputBad]}
                      accessibilityLabel={t.ratingOwnerCount}
                    />
                    <Text style={styles.hint}>{t.ratingOwnerCountHint}</Text>
                  </View>
                </View>

                <PrimaryButton
                  label={t.ratingOwnerSave}
                  busyLabel={t.ratingOwnerSaving}
                  busy={busy === "manual"}
                  disabled={busy !== null && busy !== "manual"}
                  onPress={saveManual}
                />
                {rating.manual ? (
                  <OutlineButton
                    label={busy === "clear" ? t.ratingOwnerSaving : t.ratingOwnerClear}
                    icon="trash-outline"
                    onPress={() => {
                      if (busy === null) {
                        void patch({ manual: null }, t.ratingOwnerCleared, "clear");
                      }
                    }}
                  />
                ) : null}
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
    gap: 10,
  },
  cardTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 15 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  star: { color: colors.gold, ...fonts.bodyHeavy, fontSize: 22 },
  score: { color: colors.ink, ...fonts.displayHeavy, fontSize: 28 },
  scoreCount: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13.5 },
  scoreNone: { color: colors.ink, ...fonts.bodyBold, fontSize: 17 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  warn: { color: colors.red, ...fonts.bodySemi, fontSize: 12.5, lineHeight: 17 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    // The switch is the screen's main control: a full thumb target.
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 6,
  },
  switchLabel: { flex: 1, color: colors.ink, ...fonts.bodyBold, fontSize: 15 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  link: { color: colors.red, ...fonts.bodySemi, fontSize: 13.5 },
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
  buttonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  findBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radius.pill,
  },
  findBtnText: { color: colors.red, ...fonts.bodyBold, fontSize: 14 },
  searchBox: {
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    padding: 12,
  },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  placeName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  placeAddress: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  placeUse: { color: colors.red, ...fonts.bodyBold, fontSize: 13 },
  // Two side by side on a phone; each keeps a readable minimum and wraps
  // rather than squeezing when the language is a long one.
  fieldRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  field: { flexGrow: 1, flexBasis: "45%", gap: 4 },
});
