import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ApiLoyaltyEntry, ApiMenu } from "../api";
import { BASE_URL } from "../api";
import { GOOGLE_NATIVE, useAuth, type AccountOrder } from "../auth";
import { GoogleButton } from "../google-button";
import { fill, LANGS, localeTag, useI18n } from "../i18n";
import {
  isOfferable,
  isRedeemed,
  orderNo,
  PointsBar,
  RewardSheet,
  shortDate,
  useLoyalty,
} from "../loyalty";
import { PrimaryButton } from "../components";
import { CHEVRON_FORWARD, colors, fonts, hero, logo, money, radius, scrim } from "../theme";

/**
 * Konto / Account — language, sign-in (one-tap Google, the browser device
 * flow, email/password), the signed-in customer's cross-device order
 * history, and the restaurant info. Ordering never requires an account;
 * this screen makes one optional and useful.
 */
export function AccountScreen({
  menu,
  onOpenOrder,
}: {
  menu: ApiMenu;
  onOpenOrder: (orderId: string, receiptToken: string) => void;
}): React.ReactElement {
  const { t, lang, setLang, available } = useI18n();
  const auth = useAuth();
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Refetched on mount (the tab shell rebuilds this screen every time
  // the tab is opened, so that is also "on focus") and after arming.
  const { loyalty, reload: reloadLoyalty } = useLoyalty(menu.loyalty?.enabled);
  const [rewardOpen, setRewardOpen] = useState(false);

  useEffect(() => {
    void auth.refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadOrders = useCallback(() => {
    void auth.fetchMyOrders().then(setOrders);
  }, [auth]);
  useEffect(loadOrders, [loadOrders, auth.token]);

  // Server shape: { configured, days: { mon: { closed, slots: [{open, close}] } } }
  // — a day can have several windows (lunch + dinner), shown comma-joined.
  const hoursDays = ((
    menu.venue.hours as {
      days?: Record<
        string,
        { closed?: boolean; slots?: { open?: string; close?: string }[] } | undefined
      >;
    } | null
  )?.days ?? {}) as Record<
    string,
    { closed?: boolean; slots?: { open?: string; close?: string }[] } | undefined
  >;
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const tag = localeTag(lang);
  const dt = (iso: string): string => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(tag)} · ${d.toLocaleTimeString(tag, {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };
  // The account payload is the fresher config; the menu's copy covers
  // the moment before it lands (and the signed-out case, where the card
  // isn't rendered at all).
  const loyaltyConfig = loyalty ?? menu.loyalty;
  const showRewards = Boolean(auth.token && menu.loyalty?.enabled && loyaltyConfig);
  const vouchers = (loyalty?.vouchers ?? []).filter(isOfferable);
  // Recently spent rewards, kept visible for a moment: "where did my
  // reward go" is the first question after one disappears.
  const usedVouchers = (loyalty?.vouchers ?? [])
    .filter((v) => isRedeemed(v) && v.redeemedOrderNumber !== null)
    .slice(0, 3);
  const currency = menu.venue.currency;
  // What a voucher-shaped row was worth. The entry carries its own value
  // (vouchers minted under an older threshold keep theirs); the
  // programme's current reward value is only the fallback for a server
  // that predates the field.
  const entryValue = (entry: ApiLoyaltyEntry): string =>
    money(entry.valueCents ?? loyaltyConfig?.rewardValueCents ?? 0, currency);
  const historyLabel = (entry: ApiLoyaltyEntry): string => {
    if (entry.reason === "reversal") return t.rewardsCancelled;
    if (entry.reason === "voucher") return `${t.rewardsReward} · ${entryValue(entry)}`;
    // A redemption moves no points (delta 0) — it's the note that a
    // reward was spent, so it names the money and the order instead.
    if (entry.reason === "redeem") {
      const spent = fill(t.rewardsRedeemed, { value: entryValue(entry) });
      return entry.orderNumber === null
        ? spent
        : `${spent} · ${t.rewardsOrder} #${orderNo(entry.orderNumber)}`;
    }
    if (entry.reason === "order") {
      return entry.orderNumber === null
        ? t.rewardsOrder
        : `${t.rewardsOrder} #${orderNo(entry.orderNumber)}`;
    }
    return t.rewardsAdjust;
  };

  const providerLabel = (id: string): string => (id === "google" ? t.signInGoogle : t.signInDev);

  // One tap: native Google when the build has the client ids, otherwise
  // the browser device flow — same button either way, so a build without
  // Google credentials degrades instead of dead-ending.
  async function startGoogle(): Promise<void> {
    if (authBusy || auth.busyProvider) return;
    setAuthError(null);
    const outcome = await auth.loginWithGoogle();
    if (outcome === null) {
      loadOrders();
      return;
    }
    if (outcome === "cancelled") return;
    if (outcome === "unavailable") {
      const ok = await auth.login("google");
      if (ok) loadOrders();
      return;
    }
    setAuthError(t.authFailed);
  }

  async function submitEmailAuth(mode: "login" | "register"): Promise<void> {
    if (authBusy) return;
    const email = authEmail.trim();
    if (!email.includes("@") || authPassword.length < (mode === "register" ? 8 : 1)) {
      setAuthError(t.authInvalid);
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    const err = await auth.loginWithEmail(mode, email, authPassword);
    setAuthBusy(false);
    if (err) {
      setAuthError(
        err === "exists" ? t.authExists : err === "invalid" ? t.authInvalid : t.authFailed,
      );
      return;
    }
    setAuthEmail("");
    setAuthPassword("");
    loadOrders();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ImageBackground
        source={hero}
        style={styles.hero}
        resizeMode="cover"
        imageStyle={{ width: "100%", height: "100%" }}
      >
        <View style={styles.heroOverlay}>
          <Image source={logo} style={styles.logo} />
          <Text style={styles.name}>{menu.venue.name}</Text>
        </View>
      </ImageBackground>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {/* Language */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.language}</Text>
          {/* Driven by the venue's own enabledLocales (∩ the app's
              catalogue), so a restaurant that publishes three languages
              doesn't offer five. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {LANGS.filter((l) => available.includes(l.code)).map((entry) => (
              <Pressable
                key={entry.code}
                onPress={() => setLang(entry.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: lang === entry.code }}
                style={[styles.langChip, lang === entry.code && styles.langChipActive]}
              >
                <Text style={[styles.langChipText, lang === entry.code && { color: colors.onRed }]}>
                  {entry.flag} {entry.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Account */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.accountTitle}</Text>
          {auth.customer ? (
            <>
              <Text style={styles.profileName}>{auth.customer.name ?? auth.customer.email}</Text>
              <Text style={styles.profileMail}>{auth.customer.email}</Text>
              <Pressable onPress={() => void auth.logout()} hitSlop={6}>
                <Text style={styles.signOut}>{t.signOut}</Text>
              </Pressable>

              <Text style={[styles.cardTitle, { marginTop: 16 }]}>{t.accountOrders}</Text>
              {orders.length === 0 ? (
                <Text style={styles.mutedText}>{t.ordersEmpty}</Text>
              ) : (
                orders.map((o) => (
                  <Pressable
                    key={o.orderId}
                    style={styles.orderRow}
                    onPress={() => onOpenOrder(o.orderId, o.receiptToken)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderNo}>#{String(o.orderNumber).padStart(4, "0")}</Text>
                      <Text style={styles.orderMeta}>
                        {dt(o.placedAt)} ·{" "}
                        {(t.typeLabels as Record<string, string>)[o.orderType] ?? o.orderType}
                      </Text>
                    </View>
                    <Text style={styles.orderTotal}>{money(o.totalCents, o.currency)}</Text>
                    <Text style={{ color: colors.inkSoft, ...fonts.body, fontSize: 18 }}>
                      {CHEVRON_FORWARD}
                    </Text>
                  </Pressable>
                ))
              )}
            </>
          ) : auth.busyProvider && auth.busyProvider !== GOOGLE_NATIVE ? (
            <View style={{ alignItems: "center", gap: 10, paddingVertical: 8 }}>
              <ActivityIndicator color={colors.red} />
              <Text style={styles.mutedText}>{t.signInWaiting}</Text>
              <Pressable onPress={auth.cancelLogin} hitSlop={6}>
                <Text style={styles.signOut}>{t.signInCancel}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.mutedText}>{t.signInLead}</Text>
              {/* Google always shows: native one-tap in a real build,
                  the browser flow otherwise. The remaining providers are
                  whatever the server offers (the local dev login). */}
              {auth.googleAvailable ? (
                <GoogleButton
                  label={t.continueWithGoogle}
                  onPress={() => void startGoogle()}
                  busy={auth.busyProvider === GOOGLE_NATIVE}
                />
              ) : null}
              {auth.providers
                .filter((p) => p.id !== "google")
                .map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => void auth.login(p.id).then((ok) => ok && loadOrders())}
                    style={styles.loginBtn}
                  >
                    <Text style={styles.loginBtnText}>{providerLabel(p.id)}</Text>
                  </Pressable>
                ))}

              <Text style={[styles.mutedText, { textAlign: "center" }]}>{t.orWithEmail}</Text>
              <TextInput
                value={authEmail}
                onChangeText={setAuthEmail}
                placeholder={t.email}
                placeholderTextColor={colors.inkSoft}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.authInput}
              />
              <TextInput
                value={authPassword}
                onChangeText={setAuthPassword}
                placeholder={t.passwordMin}
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                autoCapitalize="none"
                style={styles.authInput}
              />
              {authError ? <Text style={styles.authError}>{authError}</Text> : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => void submitEmailAuth("login")}
                  disabled={authBusy}
                  style={[styles.loginBtn, { flex: 1 }, authBusy && { opacity: 0.6 }]}
                >
                  <Text style={styles.loginBtnText}>{t.signInBtn}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void submitEmailAuth("register")}
                  disabled={authBusy}
                  style={[styles.loginBtnOutline, { flex: 1 }, authBusy && { opacity: 0.6 }]}
                >
                  <Text style={styles.loginBtnOutlineText}>{t.signUpBtn}</Text>
                </Pressable>
              </View>
              <Text style={[styles.mutedText, { ...fonts.body, fontSize: 11 }]}>
                {t.signInOptional}
              </Text>
            </>
          )}
        </View>

        {/* Rewards — signed in, and only where the venue runs a
            programme. Everything below reads from the server's own
            numbers, so a venue with different thresholds needs no
            change here. */}
        {showRewards && loyaltyConfig ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t.rewardsTitle}</Text>

            <View style={styles.pointsHead}>
              <Text style={styles.pointsBalance}>{loyalty?.balance ?? 0}</Text>
              <Text style={styles.pointsUnit}>{t.rewardsPoints}</Text>
            </View>
            <PointsBar have={loyalty?.balance ?? 0} need={loyaltyConfig.rewardPoints} />
            <Text style={styles.pointsProgress}>
              {loyalty?.balance ?? 0} / {loyaltyConfig.rewardPoints}
            </Text>
            <Text style={styles.pointsRule}>
              {fill(t.rewardsEarnLine, {
                min: money(loyaltyConfig.minOrderCents, currency),
                points: loyaltyConfig.pointsPerOrder,
              })}
            </Text>

            {vouchers.length > 0 ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <Text style={styles.subLabel}>{t.rewardsWaiting}</Text>
                {vouchers.map((v) => {
                  const until = shortDate(v.expiresAt, tag);
                  return (
                    <View key={v.id} style={styles.voucherRow}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.voucherText}>
                          {fill(t.rewardsMeal, { value: money(v.valueCents, currency) })}
                          {until ? ` · ${fill(t.rewardsValidUntil, { date: until })}` : ""}
                        </Text>
                        {v.status === "armed" ? (
                          <Text style={styles.armedPill}>{t.rewardsArmedPill}</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {usedVouchers.length > 0 ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                {usedVouchers.map((v) => (
                  <View key={v.id} style={[styles.voucherRow, styles.voucherRowUsed]}>
                    <Text style={styles.voucherUsedText}>
                      {fill(t.rewardsMeal, { value: money(v.valueCents, currency) })} ·{" "}
                      {fill(t.rewardsUsedOn, { number: orderNo(v.redeemedOrderNumber ?? 0) })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ marginTop: 12 }}>
              <PrimaryButton label={t.rewardsCheck} onPress={() => setRewardOpen(true)} />
            </View>

            <Text style={[styles.subLabel, { marginTop: 16 }]}>{t.rewardsHistory}</Text>
            {(loyalty?.history ?? []).length === 0 ? (
              <Text style={styles.mutedText}>{t.rewardsHistoryEmpty}</Text>
            ) : (
              (loyalty?.history ?? []).slice(0, 6).map((entry) => {
                const when = shortDate(entry.createdAt, tag);
                return (
                  <View key={entry.id} style={styles.historyRow}>
                    {/* A redemption costs no points, so a "+0" would be
                        noise — the gift marks the row instead. */}
                    <Text
                      style={[styles.historyDelta, entry.delta < 0 && { color: colors.inkSoft }]}
                    >
                      {entry.reason === "redeem"
                        ? "🎁"
                        : `${entry.delta < 0 ? "−" : "+"}${Math.abs(entry.delta)}`}
                    </Text>
                    <Text style={styles.historyLabel} numberOfLines={1}>
                      {historyLabel(entry)}
                    </Text>
                    {when ? <Text style={styles.historyDate}>{when}</Text> : null}
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* Hours */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.hours}</Text>
          {dayKeys.map((key, i) => {
            const h = hoursDays[key];
            const windows = (h?.slots ?? []).filter((s) => s.open && s.close);
            const text =
              !h || h.closed || windows.length === 0
                ? t.closed
                : windows.map((s) => `${s.open} – ${s.close}`).join(", ");
            return (
              <View key={key} style={styles.hoursRow}>
                <Text style={styles.hoursDay}>{t.days[i]}</Text>
                <Text style={styles.hoursTime}>{text}</Text>
              </View>
            );
          })}
        </View>

        {/* Links */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.more}</Text>
          <LinkRow label={t.webMenu} onPress={() => void Linking.openURL(BASE_URL)} />
          <LinkRow
            label={t.imprint}
            onPress={() => void Linking.openURL(`${BASE_URL}/legal/impressum`)}
          />
          <LinkRow
            label={t.privacy}
            onPress={() => void Linking.openURL(`${BASE_URL}/legal/privacy`)}
          />
        </View>

        <Text style={styles.footer}>{t.footer}</Text>
      </ScrollView>
      <RewardSheet
        visible={rewardOpen}
        loyalty={loyalty}
        config={
          loyaltyConfig ?? {
            enabled: false,
            minOrderCents: 0,
            pointsPerOrder: 0,
            rewardPoints: 0,
            rewardValueCents: 0,
          }
        }
        currency={currency}
        onClose={() => setRewardOpen(false)}
        onChanged={reloadLoyalty}
      />
    </View>
  );
}

function LinkRow({ label, onPress }: { label: string; onPress: () => void }): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.linkRow}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={{ color: colors.inkSoft, ...fonts.body, fontSize: 18 }}>{CHEVRON_FORWARD}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { height: 150 },
  heroOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: scrim,
  },
  logo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cream },
  name: {
    color: colors.onRed,
    fontSize: 20,
    ...fonts.bodyHeavy,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 5,
  },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  cardTitle: { color: colors.ink, fontSize: 15, ...fonts.bodyHeavy, marginBottom: 8 },
  langChip: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.cream,
  },
  langChipActive: { backgroundColor: colors.red, borderColor: colors.red },
  langChipText: { color: colors.ink, fontSize: 13, ...fonts.bodyBold },
  profileName: { color: colors.ink, fontSize: 15, ...fonts.bodyBold },
  profileMail: { color: colors.inkSoft, ...fonts.body, fontSize: 12, marginTop: 1 },
  signOut: { color: colors.red, fontSize: 13, ...fonts.bodyBold, marginTop: 8 },
  mutedText: { color: colors.inkSoft, ...fonts.body, fontSize: 13, marginBottom: 8 },
  loginBtn: {
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: "center",
    marginBottom: 8,
    backgroundColor: colors.cream,
  },
  loginBtnText: { color: colors.red, ...fonts.bodyHeavy, fontSize: 13 },
  loginBtnOutline: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: "center",
    marginBottom: 8,
    backgroundColor: colors.creamCard,
  },
  loginBtnOutlineText: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 13 },
  authInput: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    ...fonts.body,
    fontSize: 14,
    marginBottom: 8,
  },
  authError: {
    color: colors.danger,
    ...fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginBottom: 6,
  },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
  },
  orderNo: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 14 },
  orderMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 11, marginTop: 1 },
  orderTotal: { color: colors.red, ...fonts.bodyHeavy, fontSize: 13 },
  pointsHead: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 8 },
  pointsBalance: { color: colors.red, ...fonts.displayHeavy, fontSize: 40, lineHeight: 44 },
  pointsUnit: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 14 },
  pointsProgress: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12, marginTop: 6 },
  pointsRule: { color: colors.ink, ...fonts.body, fontSize: 13, marginTop: 6, lineHeight: 19 },
  subLabel: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  voucherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.cream,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  voucherText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13.5 },
  // A spent reward: the same card, stood down — no gold border, no claim
  // on the guest's attention.
  voucherRowUsed: { borderColor: colors.line, borderWidth: 1, backgroundColor: colors.creamCard },
  voucherUsedText: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, flex: 1 },
  armedPill: { color: colors.gold, ...fonts.bodyBold, fontSize: 11 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
  },
  historyDelta: {
    color: colors.positive,
    ...fonts.bodyHeavy,
    fontSize: 13,
    minWidth: 34,
  },
  historyLabel: { color: colors.ink, ...fonts.body, fontSize: 13, flex: 1 },
  historyDate: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
  hoursRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  hoursDay: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  hoursTime: { color: colors.ink, fontSize: 13, ...fonts.bodySemi },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  linkText: { color: colors.ink, fontSize: 14, ...fonts.bodySemi },
  footer: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
});
