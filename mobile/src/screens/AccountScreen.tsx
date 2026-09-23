import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ApiContactEntry, ApiLoyaltyEntry, ApiMenu, ApiVenueContact } from "../api";
import { BASE_URL, contactEntries, requestPasswordReset } from "../api";
import {
  APPLE_NATIVE,
  appReturnUrl,
  GOOGLE_NATIVE,
  RESET_STATUS,
  useAuth,
  type AccountOrder,
} from "../auth";
import { AppleButton } from "../apple-button";
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
import { ReservationsCard } from "../reservations";
import { displayVenueName, venueNameLines } from "../venue-name";
import {
  BrandHeader,
  FieldLabel,
  OutlineButton,
  PrimaryButton,
  RequiredLegend,
} from "../components";
import { CartoonTitle } from "../cartoon-title";
import { CHEVRON_FORWARD, colors, fonts, money, radius } from "../theme";

/**
 * Konto / Account — language, sign-in (one-tap Google, the browser device
 * flow, email/password), the signed-in customer's cross-device order
 * history, and the restaurant info. Ordering never requires an account;
 * this screen makes one optional and useful.
 *
 * The same form signs the RESTAURANT in: the server decides what the
 * credentials were and may hand back a staff session instead. When it
 * does, this screen becomes the owner's: who is signed in, sign out,
 * language — and none of the guest sections, which would either be empty
 * (an account's order history) or meaningless (the guest's own rewards).
 * Signed OUT, nothing here hints that a restaurant login exists.
 */
export function AccountScreen({
  menu,
  menuLoading = false,
  menuError = false,
  onOpenOrder,
  onOpenGiftCards,
  onOpenOwnerMenu,
}: {
  menu: ApiMenu;
  /** The dish text is being refetched in the language just picked. This
   *  screen keeps working — it is where the picker lives, and hiding it
   *  behind the shell's loading panel would take away the one piece of
   *  feedback the tap deserves — so it says so inline instead. */
  menuLoading?: boolean;
  /** That refetch failed. Same line, different words: the chip stays
   *  selected, the menu simply hasn't arrived. */
  menuError?: boolean;
  onOpenOrder: (orderId: string, receiptToken: string) => void;
  /** The cards this account has bought. Offered to signed-in guests
   *  only: there is no list to show a device with no account. */
  onOpenGiftCards: () => void;
  /** Restaurant mode only: opens the burger's sheet. */
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang, setLang, available, deferReload } = useI18n();
  const auth = useAuth();
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  /** The forgotten-password panel (P7-15): closed, asking for the
   *  address, or done. It is deliberately inline rather than an
   *  `Alert.prompt` — that one is iOS-only, and a guest on Android must
   *  be able to correct the address the form guessed for them. */
  const [forgot, setForgot] = useState<"closed" | "form" | "sent">("closed");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  // Refetched on mount (the tab shell rebuilds this screen every time
  // the tab is opened, so that is also "on focus") and after arming.
  const { loyalty, reload: reloadLoyalty } = useLoyalty(menu.loyalty?.enabled);
  const [rewardOpen, setRewardOpen] = useState(false);

  const staff = auth.staff;
  const venueLines = venueNameLines(displayVenueName(menu.venue.name));
  useEffect(() => {
    // Not in restaurant mode: the endpoint mints a device code, and the
    // owner is never offered a provider button.
    if (!staff) void auth.refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(staff)]);
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
  // The venue's phone book, already parsed and filtered by `api.ts`:
  // an empty list is the whole test for "no contact card".
  const contacts = contactEntries(menu.venue.contact);
  const contactLabel: Record<keyof ApiVenueContact, string> = {
    landline: t.contactCallLandline,
    mobile: t.contactCallMobile,
    whatsapp: t.contactWhatsapp,
    email: t.contactEmail,
  };
  // `href` is the SERVER's (`tel:+49…`, `mailto:info@…`), never one the
  // app assembled.
  const openHref = (entry: ApiContactEntry): Promise<void> =>
    Linking.openURL(entry.href).catch(() => {});
  /**
   * WhatsApp, with the one fallback that matters: a device without the
   * app installed can refuse the link, and `https://wa.me/<number>`
   * opens WhatsApp Web (or the store page) in the browser instead. That
   * is the same URL the server sends, so the fallback is a retry on a
   * device that is sure to take it rather than a second guess.
   */
  const openWhatsapp = async (entry: ApiContactEntry): Promise<void> => {
    const web = `https://wa.me/${entry.number.replace(/\D/g, "")}`;
    const can = await Linking.canOpenURL(entry.href).catch(() => false);
    if (can) {
      const opened = await Linking.openURL(entry.href).then(
        () => true,
        () => false,
      );
      if (opened) return;
    }
    await Linking.openURL(web).catch(() => {});
  };
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
  const showRewards = Boolean(!staff && auth.token && menu.loyalty?.enabled && loyaltyConfig);
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

  // "Konto löschen" — required by both app stores. Always behind a
  // native confirm that says what goes and what stays; the server call
  // signs the device out itself once the account is gone.
  const confirmDeleteAccount = (): void => {
    Alert.alert(t.deleteAccountTitle, t.deleteAccountBody, [
      { text: t.signInCancel, style: "cancel" },
      {
        text: t.deleteAccountConfirm,
        style: "destructive",
        onPress: () => {
          void auth.deleteAccount().then((ok) => {
            Alert.alert(ok ? t.deleteAccountDone : t.deleteAccountFailed);
          });
        },
      },
    ]);
  };

  // Restaurant mode asks first: signing out takes the live orders board
  // off the counter's phone, which is not something to lose to a mis-tap.
  const confirmStaffSignOut = (): void => {
    Alert.alert(t.signOutStaff, undefined, [
      { text: t.signInCancel, style: "cancel" },
      { text: t.signOut, style: "destructive", onPress: () => void auth.logoutStaff() },
    ]);
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

  async function startApple(): Promise<void> {
    if (authBusy || auth.busyProvider) return;
    setAuthError(null);
    const outcome = await auth.loginWithApple();
    if (outcome === null) {
      loadOrders();
      return;
    }
    if (outcome !== "cancelled") setAuthError(t.authFailed);
  }

  /**
   * Ask the server to mail a reset link. The answer is the same whether
   * or not that address has an account (no enumeration), so "sent" here
   * means the REQUEST got through — never that an account exists.
   *
   * `appReturnUrl(RESET_STATUS)` is this app's own deep link with the
   * outcome already on it: the web reset page carries it back untouched,
   * and `AuthProvider` reads the status off the URL that reopens the app.
   */
  async function submitForgot(): Promise<void> {
    if (forgotBusy) return;
    const email = forgotEmail.trim();
    if (!email.includes("@")) {
      setForgotError(t.forgotBadEmail);
      return;
    }
    setForgotBusy(true);
    setForgotError(null);
    const ok = await requestPasswordReset(email, {
      locale: lang,
      appReturnUrl: appReturnUrl(RESET_STATUS),
    });
    setForgotBusy(false);
    if (!ok) {
      setForgotError(t.forgotFailed);
      return;
    }
    setForgot("sent");
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
      {/* The SAME red bar the rest of the app wears — the mascot, the
          venue's lockup, and nothing else (owner, 2026-09-22). This
          screen used to build its own 150 pt artwork hero with the name
          and town on it; two headings for one venue meant two things to
          keep in step, and the bar already says who this is. No points
          badge here (this IS where the balance lives, further down) and
          no rating line (the Home screen is where a guest is deciding). */}
      <BrandHeader title={venueLines.line1} sticker onMenu={onOpenOwnerMenu} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {/* Language */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.language}</Text>
          {/* Driven by the venue's own enabledLocales (∩ the app's
              catalogue), so a restaurant that publishes three languages
              doesn't offer six. Order follows `LANGS`, which mirrors the
              web registry: Deutsch, English, Français, Español,
              Italiano, العربية. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {LANGS.filter((l) => available.includes(l.code)).map((entry) => (
              <Pressable
                key={entry.code}
                onPress={() => {
                  setLang(entry.code);
                  // Signed in? Then this is an account preference, not a
                  // device one — it should still be French on their
                  // tablet. A no-op when signed out.
                  //
                  // Handed to `deferReload` because switching to (or out
                  // of) Arabic restarts the app: an unfinished PATCH died
                  // with the old process, the server kept the previous
                  // language, and `/api/v1/me` then pushed it straight
                  // back over the choice the guest had just made.
                  deferReload(auth.saveLocale(entry.code));
                }}
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
          {menuLoading || menuError ? (
            <View style={styles.langStatus} accessibilityRole={menuError ? "alert" : "progressbar"}>
              {menuError ? null : <ActivityIndicator color={colors.red} size="small" />}
              <Text style={styles.langStatusText}>{menuError ? t.bootError : t.bootLoading}</Text>
            </View>
          ) : null}
        </View>

        {/* Account — or, in restaurant mode, who the counter is signed
            in as and the way back out. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{staff ? t.staffSignedIn : t.accountTitle}</Text>
          {staff ? (
            <>
              {/* Who the counter is signed in as. One line by nature, so
                  it takes the name's first line rather than the stored
                  string with its " · Konstanz" trailing off the end. */}
              <Text style={styles.profileName}>{staff.name || venueLines.line1}</Text>
              {staff.email ? <Text style={styles.profileMail}>{staff.email}</Text> : null}
              <View style={styles.signOutBox}>
                <OutlineButton
                  label={t.signOutStaff}
                  icon="log-out-outline"
                  onPress={confirmStaffSignOut}
                />
              </View>
            </>
          ) : auth.customer ? (
            <>
              <Text style={styles.profileName}>{auth.customer.name ?? auth.customer.email}</Text>
              <Text style={styles.profileMail}>{auth.customer.email}</Text>

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

              <View style={styles.signOutBox}>
                <OutlineButton
                  label={t.signOut}
                  icon="log-out-outline"
                  onPress={() => void auth.logout()}
                />
                {/* A quiet text link under sign-out: findable, but never
                    the thing a thumb lands on by accident. */}
                <Pressable
                  onPress={confirmDeleteAccount}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.deleteAccount}
                >
                  <Text style={styles.signOut}>{t.deleteAccount}</Text>
                </Pressable>
              </View>
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
              {/* iPhone: Apple first — guideline 4.8 wants it offered as an
                  equal to Google, and Apple's HIG puts it on top. */}
              {auth.appleAvailable ? (
                <AppleButton
                  onPress={() => void startApple()}
                  busy={auth.busyProvider === APPLE_NATIVE}
                />
              ) : null}
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
              {/* Both fields are checked before anything is sent
                  (`submitEmailAuth`), so both carry the mark — and the
                  labels replace the placeholders they used to repeat. */}
              <RequiredLegend style={{ marginBottom: 6 }} />
              <FieldLabel label={t.email} required style={styles.authLabel} />
              <TextInput
                value={authEmail}
                onChangeText={setAuthEmail}
                placeholderTextColor={colors.inkSoft}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                accessibilityLabel={t.email}
                style={styles.authInput}
              />
              <FieldLabel label={t.passwordMin} required style={styles.authLabel} />
              <TextInput
                value={authPassword}
                onChangeText={setAuthPassword}
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                autoCapitalize="none"
                accessibilityLabel={t.passwordMin}
                style={styles.authInput}
              />
              {/* Under the password field, where the guest is when they
                  realise they don't have it. */}
              {forgot === "closed" ? (
                <Pressable
                  onPress={() => {
                    setForgotEmail(authEmail.trim());
                    setForgotError(null);
                    setForgot("form");
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.forgotLinkBox, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.forgotLink}>{t.forgotPassword}</Text>
                </Pressable>
              ) : (
                <View style={styles.forgotPanel}>
                  {forgot === "sent" ? (
                    <>
                      <Text style={styles.forgotTitle}>{t.forgotSentTitle}</Text>
                      <Text style={styles.forgotIntro}>{t.forgotSentBody}</Text>
                      <Pressable
                        onPress={() => setForgot("closed")}
                        hitSlop={8}
                        accessibilityRole="button"
                        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.forgotLink}>{t.back}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={styles.forgotTitle}>{t.forgotTitle}</Text>
                      <Text style={styles.forgotIntro}>{t.forgotIntro}</Text>
                      <FieldLabel label={t.email} required style={styles.authLabel} />
                      <TextInput
                        value={forgotEmail}
                        onChangeText={setForgotEmail}
                        placeholderTextColor={colors.inkSoft}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        accessibilityLabel={t.email}
                        style={styles.authInput}
                      />
                      {forgotError ? <Text style={styles.authError}>{forgotError}</Text> : null}
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                          onPress={() => void submitForgot()}
                          disabled={forgotBusy}
                          accessibilityRole="button"
                          style={[styles.loginBtn, { flex: 1 }, forgotBusy && { opacity: 0.6 }]}
                        >
                          <Text style={styles.loginBtnText}>
                            {forgotBusy ? t.forgotSending : t.forgotSend}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setForgot("closed")}
                          disabled={forgotBusy}
                          accessibilityRole="button"
                          style={[
                            styles.loginBtnOutline,
                            { flex: 1 },
                            forgotBusy && { opacity: 0.6 },
                          ]}
                        >
                          <Text style={styles.loginBtnOutlineText}>{t.signInCancel}</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              )}
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
            {/* No "0 / 100" under the bar: the balance is already the big
                number above, and points keep counting past the reward. */}
            <PointsBar have={loyalty?.balance ?? 0} need={loyaltyConfig.rewardPoints} />
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

        {/* Reservations — the one guest section that does NOT need an
            account: the ids + tokens on this device are enough to ask
            the server how each request went, and a signed-in guest also
            gets the ones filed on their other phone. The card renders
            itself away when there is nothing to show. */}
        {!staff ? <ReservationsCard token={auth.token} /> : null}

        {/* Contact — the one card that is about the RESTAURANT rather
            than about this device, so it shows whether or not anybody is
            signed in. It renders itself away when the owner has filled
            in none of the four slots. */}
        {contacts.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t.contactTitle}</Text>
            {contacts.map(({ key, entry }) => (
              <ContactRow
                key={key}
                icon={
                  key === "whatsapp"
                    ? "logo-whatsapp"
                    : key === "email"
                      ? "mail-outline"
                      : "call-outline"
                }
                label={contactLabel[key]}
                entry={entry}
                onPress={() => void (key === "whatsapp" ? openWhatsapp(entry) : openHref(entry))}
              />
            ))}
          </View>
        ) : null}

        {/* Hours */}
        <View style={styles.card}>
          {/* The owner's sticker lettering, behind the clock the mock
              puts in front of it. */}
          <View style={styles.hoursTitleRow}>
            <Ionicons name="time-outline" size={24} color={colors.ink} />
            <CartoonTitle text={t.hours.toLocaleUpperCase()} size={21} />
          </View>
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
          {/* The guest's own cards, above the web links: it is the one
              row here that is about THEM rather than about the venue.
              Signed out there is nothing to list — the buy screen's own
              soft gate is where that conversation belongs. */}
          {!staff && auth.token ? (
            <LinkRow label={t.giftCardsMine} onPress={onOpenGiftCards} />
          ) : null}
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

/** One way to reach the restaurant: what the tap does, then the number
 *  itself. Both are in the accessibility label, so a screen reader
 *  announces "Call landline, plus 49 7531 …" rather than just an icon. */
function ContactRow({
  icon,
  label,
  entry,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  entry: ApiContactEntry;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} · ${entry.display}`}
      style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={colors.red} />
      <View style={{ flex: 1 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={styles.contactNumber}>{entry.display}</Text>
      </View>
      <Text style={{ color: colors.inkSoft, ...fonts.body, fontSize: 18 }}>{CHEVRON_FORWARD}</Text>
    </Pressable>
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
  hoursTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  cardTitle: { color: colors.ink, fontSize: 15, ...fonts.bodyHeavy, marginBottom: 8 },
  langStatus: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  langStatusText: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
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
  signOutBox: { marginTop: 16 },
  deleteAccount: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
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
  authLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12, marginBottom: 4 },
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
  // Quiet by design: the way out of a forgotten password should be
  // findable without competing with the sign-in button beside it.
  forgotLinkBox: { alignSelf: "flex-start", paddingVertical: 4, marginBottom: 6 },
  forgotLink: { color: colors.red, ...fonts.bodyBold, fontSize: 12.5 },
  forgotPanel: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  forgotTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  forgotIntro: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 18 },
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
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // A phone number is tapped with a thumb, often in a hurry.
    minHeight: 48,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  contactLabel: { color: colors.ink, fontSize: 14, ...fonts.bodySemi },
  contactNumber: { color: colors.inkSoft, ...fonts.body, fontSize: 13, marginTop: 1 },
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
