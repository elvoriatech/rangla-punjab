import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../auth";
import type { StaffLoyalty, StaffLoyaltyConfig, StaffLoyaltyPatch } from "../staff";
import { LOYALTY_LIMITS, fetchStaffLoyalty, updateStaffLoyalty } from "../staff";
import { BrandHeader, PrimaryButton } from "../components";
import { fill, localeTag, useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, money, radius } from "../theme";

/**
 * The restaurant's view of the loyalty programme: whether it is running,
 * the rules it runs on, what those rules have added up to, and who is
 * collecting.
 *
 * The switch and the numbers are deliberately DIFFERENT controls. The
 * switch saves itself the moment it moves — a venue that has to stop
 * giving points mid-service should not have to find a Save button — and
 * reverts if the server refuses. The numbers are a pricing decision
 * (what an order is worth, what a reward costs the venue), so they are
 * typed, validated against the server's own limits, and saved together
 * on purpose.
 *
 * Money is shown in EUROS and sent in integer CENTS: the input takes a
 * comma or a dot, because half of this app's languages write 2,50.
 *
 * The guests' own Rewards card is untouched; this is the same programme
 * seen from behind the counter.
 */

/** The five numbers the form edits, as the owner typed them. */
type Draft = Record<keyof StaffLoyaltyConfig, string>;

/** Which of them are money (shown as euros) rather than counts. */
const MONEY_FIELDS: readonly (keyof StaffLoyaltyConfig)[] = ["minOrderCents", "rewardValueCents"];

/**
 * "2,50" / "2.50" / "" → cents. Unlike the menu editor's `parsePrice`,
 * ZERO is a legitimate answer here: a minimum order of nothing means
 * every order earns, which is a setting a venue may well want.
 */
function parseEuros(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** A plain count: whole, non-negative, no separators. */
function parseCount(text: string): number | null {
  const cleaned = text.trim().replace(/[\s.,]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function draftOf(config: StaffLoyaltyConfig, decimal: string): Draft {
  const euros = (cents: number): string => (cents / 100).toFixed(2).replace(".", decimal);
  return {
    minOrderCents: euros(config.minOrderCents),
    pointsPerOrder: String(config.pointsPerOrder),
    rewardPoints: String(config.rewardPoints),
    rewardValueCents: euros(config.rewardValueCents),
    voucherExpiryMonths: String(config.voucherExpiryMonths),
  };
}
export function LoyaltyStaffScreen({
  currency,
  onBack,
  onOpenOwnerMenu,
}: {
  currency: string;
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const [data, setData] = useState<StaffLoyalty | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  /** The input the server (or this screen) refused, marked under it. */
  const [badField, setBadField] = useState<keyof StaffLoyaltyConfig | null>(null);
  const tag = localeTag(lang);
  const decimal = lang === "en" ? "." : ",";

  /** One place where a server answer becomes the screen, so a refused
   *  edit never lingers in an input. */
  const adopt = useCallback(
    (next: StaffLoyalty): void => {
      setData(next);
      setDraft(draftOf(next.config, decimal));
      setDirty(false);
      setBadField(null);
    },
    [decimal],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffLoyalty(staffToken);
    setLoaded(true);
    if (res.ok) {
      // A reload must not overwrite numbers the owner is mid-way through
      // typing — the pull-to-refresh is for the totals below, not the
      // form above.
      setData(res.data);
      setDraft((current) => (current && dirty ? current : draftOf(res.data.config, decimal)));
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    // Keep whatever is on screen: a stale table beats an empty one.
    else setFailed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffToken, clearStaff, decimal]);

  /**
   * The switch moves at once and the server either confirms it or puts
   * it back — waiting on a round trip makes a switch feel broken.
   */
  const toggleEnabled = useCallback(
    (next: boolean): void => {
      if (!data || !staffToken) return;
      const before = data;
      setData({ ...data, enabled: next, config: { ...data.config } });
      setNotice(null);
      void updateStaffLoyalty(staffToken, { enabled: next }).then((res) => {
        if (res.ok) {
          // Turning the programme on can change what the server reports
          // below it, so the whole overview is adopted, not just the flag.
          adopt(res.data);
          return;
        }
        setData(before);
        if (res.error === "unauthorized") clearStaff();
        else setNotice({ tone: "bad", text: t.staffLoyaltyToggleFailed });
      });
    },
    [data, staffToken, adopt, clearStaff, t],
  );

  const saveSettings = useCallback(async (): Promise<void> => {
    if (!draft || !staffToken || saving) return;
    const patch: StaffLoyaltyPatch = {};
    for (const key of Object.keys(draft) as (keyof StaffLoyaltyConfig)[]) {
      const isMoney = MONEY_FIELDS.includes(key);
      const value = isMoney ? parseEuros(draft[key]) : parseCount(draft[key]);
      if (value === null || value > LOYALTY_LIMITS[key]) {
        setBadField(key);
        setNotice({
          tone: "bad",
          text: fill(isMoney ? t.staffLoyaltyBadAmount : t.staffLoyaltyBadNumber, {
            max: isMoney
              ? money(LOYALTY_LIMITS[key], currency)
              : LOYALTY_LIMITS[key].toLocaleString(tag),
          }),
        });
        return;
      }
      patch[key] = value;
    }
    setSaving(true);
    setNotice(null);
    const res = await updateStaffLoyalty(staffToken, patch);
    setSaving(false);
    if (res.ok) {
      adopt(res.data);
      setNotice({ tone: "ok", text: t.staffLoyaltySaved });
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      return;
    }
    // The server names the key it refused — mark that input rather than
    // leaving the owner to guess which of five numbers was wrong.
    const field = (Object.keys(LOYALTY_LIMITS) as (keyof StaffLoyaltyConfig)[]).find(
      (key) => key === res.field,
    );
    setBadField(field ?? null);
    setNotice({ tone: "bad", text: t.staffLoyaltySaveFailed });
  }, [draft, staffToken, saving, adopt, clearStaff, currency, tag, t]);

  const onField = useCallback((key: keyof StaffLoyaltyConfig, value: string): void => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setBadField(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const dateOf = (iso: string | null): string => {
    if (!iso) return t.staffLoyaltyNoOrder;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t.staffLoyaltyNoOrder;
    return fill(t.staffLoyaltyLastOrder, {
      date: d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit", year: "2-digit" }),
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.staffLoyaltyTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.red}
            />
          }
        >
          {!loaded ? (
            <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
          ) : !data ? (
            <Text style={styles.failed}>{t.staffLoadFailed}</Text>
          ) : (
            <>
              {failed ? <Text style={styles.failed}>{t.staffLoadFailed}</Text> : null}
              {notice ? (
                <Text style={notice.tone === "ok" ? styles.ok : styles.failed}>{notice.text}</Text>
              ) : null}

              {/* The master switch. First thing on the screen because it is
                the thing a venue reaches for mid-service. */}
              <View style={[styles.banner, data.enabled ? styles.bannerOn : styles.bannerOff]}>
                <Text style={styles.bannerEmoji}>{data.enabled ? "🎁" : "💤"}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.bannerTitle}>{t.staffLoyaltyEnable}</Text>
                  <Text style={styles.bannerHint}>
                    {data.enabled ? t.staffLoyaltyOn : t.staffLoyaltyEnableHint}
                  </Text>
                </View>
                <Switch
                  value={data.enabled}
                  onValueChange={toggleEnabled}
                  accessibilityLabel={t.staffLoyaltyEnable}
                  trackColor={{ false: colors.line, true: colors.red }}
                  thumbColor={colors.cream}
                />
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t.staffLoyaltySettings}</Text>
                <Text style={styles.settingsHint}>{t.staffLoyaltySettingsHint}</Text>
                {draft ? (
                  <>
                    <Field
                      label={t.staffLoyaltyMinOrder}
                      value={draft.minOrderCents}
                      money
                      bad={badField === "minOrderCents"}
                      onChange={(v) => onField("minOrderCents", v)}
                    />
                    <Field
                      label={t.staffLoyaltyPerOrder}
                      value={draft.pointsPerOrder}
                      bad={badField === "pointsPerOrder"}
                      onChange={(v) => onField("pointsPerOrder", v)}
                    />
                    <Field
                      label={t.staffLoyaltyRewardPoints}
                      value={draft.rewardPoints}
                      bad={badField === "rewardPoints"}
                      onChange={(v) => onField("rewardPoints", v)}
                    />
                    <Field
                      label={t.staffLoyaltyRewardValue}
                      value={draft.rewardValueCents}
                      money
                      bad={badField === "rewardValueCents"}
                      onChange={(v) => onField("rewardValueCents", v)}
                    />
                    <Field
                      label={t.staffLoyaltyExpiry}
                      value={draft.voucherExpiryMonths}
                      hint={t.staffLoyaltyMonthsHint}
                      bad={badField === "voucherExpiryMonths"}
                      onChange={(v) => onField("voucherExpiryMonths", v)}
                    />
                    <PrimaryButton
                      label={t.staffLoyaltySave}
                      busyLabel={t.hoursSaving}
                      busy={saving}
                      disabled={!dirty || saving}
                      onPress={() => void saveSettings()}
                    />
                  </>
                ) : null}
              </View>

              <View style={styles.tiles}>
                <Tile label={t.staffLoyaltyMembers} value={data.totals.members} />
                <Tile label={t.staffLoyaltyPointsOut} value={data.totals.pointsOutstanding} />
                <Tile label={t.staffLoyaltyVouchers} value={data.totals.vouchersAvailable} gold />
                <Tile label={t.staffLoyaltyRedeemed} value={data.totals.vouchersRedeemed30d} />
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t.staffLoyaltyGuests}</Text>
                {data.members.length === 0 ? (
                  <Text style={styles.empty}>{t.staffLoyaltyEmpty}</Text>
                ) : (
                  data.members.map((m) => (
                    <View key={m.customerId} style={styles.memberRow}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {m.name ?? m.email ?? "—"}
                        </Text>
                        <Text style={styles.memberMeta} numberOfLines={1}>
                          {dateOf(m.lastOrderAt)}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 2 }}>
                        <Text style={styles.memberPoints}>
                          {fill(t.staffLoyaltyPoints, { points: m.balance })}
                        </Text>
                        {m.vouchersAvailable > 0 ? (
                          <View style={styles.rewardPill}>
                            <Text style={styles.rewardPillText}>
                              {fill(t.staffLoyaltyRewardsReady, { count: m.vouchersAvailable })}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * One number of the programme. Money fields take a comma or a dot and
 * are converted to cents by the caller; counts take digits only. The
 * keyboard follows, so a tablet never offers letters for a price.
 */
function Field({
  label,
  value,
  onChange,
  money: isMoney,
  hint,
  bad,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  money?: boolean;
  hint?: string;
  bad?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.fieldRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.configLabel}>{label}</Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={isMoney ? "decimal-pad" : "number-pad"}
        inputMode={isMoney ? "decimal" : "numeric"}
        maxLength={isMoney ? 10 : 7}
        accessibilityLabel={label}
        style={[styles.input, bad && styles.inputBad]}
        placeholderTextColor={colors.inkSoft}
      />
    </View>
  );
}

function Tile({
  label,
  value,
  gold,
}: {
  label: string;
  value: number;
  gold?: boolean;
}): React.ReactElement {
  return (
    <View style={[styles.tile, gold && styles.tileGold]}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  ok: { color: colors.positive, ...fonts.bodySemi, fontSize: 13 },
  settingsHint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  fieldHint: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5, lineHeight: 15 },
  input: {
    width: 116,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    textAlign: "right",
    color: colors.ink,
    ...fonts.bodySemi,
    fontSize: 15,
  },
  inputBad: { borderColor: colors.danger, borderWidth: 1.5 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerOn: { backgroundColor: colors.creamCard, borderColor: colors.goldSoft },
  bannerOff: { backgroundColor: colors.creamCard, borderColor: colors.line },
  bannerEmoji: { ...fonts.body, fontSize: 24 },
  bannerTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 15 },
  bannerHint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
  },
  cardTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 15, marginBottom: 2 },
  configRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 3,
  },
  configLabel: { flex: 1, color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  configValue: { color: colors.ink, ...fonts.bodySemi, fontSize: 13.5 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  // Two up on a phone, four across on a tablet — the tiles size
  // themselves off the row rather than a breakpoint.
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  tileGold: { borderColor: colors.goldSoft },
  tileValue: { color: colors.red, ...fonts.displayHeavy, fontSize: 24 },
  tileLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11.5 },
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  memberName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  memberMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  memberPoints: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 13.5 },
  rewardPill: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rewardPillText: { color: colors.ink, ...fonts.bodyBold, fontSize: 10.5 },
});
