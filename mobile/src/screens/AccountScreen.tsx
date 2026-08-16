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
  View,
} from "react-native";
import type { ApiMenu } from "../api";
import { BASE_URL } from "../api";
import { useAuth, type AccountOrder } from "../auth";
import { useI18n, type Lang } from "../i18n";
import { colors, fonts, money, radius } from "../theme";

/**
 * Konto / Account — language, sign-in (Google · Microsoft/Hotmail · local
 * dev), the signed-in customer's cross-device order history, and the
 * restaurant info. Ordering never requires an account; this screen makes
 * one optional and useful.
 */
export function AccountScreen({
  menu,
  onOpenOrder,
}: {
  menu: ApiMenu;
  onOpenOrder: (orderId: string, receiptToken: string) => void;
}): React.ReactElement {
  const { t, lang, setLang } = useI18n();
  const auth = useAuth();
  const [orders, setOrders] = useState<AccountOrder[]>([]);

  useEffect(() => {
    void auth.refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadOrders = useCallback(() => {
    void auth.fetchMyOrders().then(setOrders);
  }, [auth]);
  useEffect(loadOrders, [loadOrders, auth.token]);

  const hours = (menu.venue.hours ?? {}) as Record<
    string,
    { open?: string; close?: string; closed?: boolean } | undefined
  >;
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const dt = (iso: string): string => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB")} · ${d.toLocaleTimeString(
      lang === "de" ? "de-DE" : "en-GB",
      { hour: "2-digit", minute: "2-digit" },
    )}`;
  };
  const providerLabel = (id: string): string =>
    id === "google" ? t.signInGoogle : id === "microsoft" ? t.signInMicrosoft : t.signInDev;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ImageBackground source={require("../../assets/artwork.jpg")} style={styles.hero}>
        <View style={styles.heroOverlay}>
          <Image source={require("../../assets/rangla-logo.png")} style={styles.logo} />
          <Text style={styles.name}>{menu.venue.name}</Text>
        </View>
      </ImageBackground>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {/* Language */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.language}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["de", "en"] as Lang[]).map((code) => (
              <Pressable
                key={code}
                onPress={() => setLang(code)}
                style={[styles.langChip, lang === code && styles.langChipActive]}
              >
                <Text style={[styles.langChipText, lang === code && { color: colors.onRed }]}>
                  {code === "de" ? "🇩🇪 Deutsch" : "🇬🇧 English"}
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
                    <Text style={{ color: colors.inkSoft, fontFamily: fonts.body, fontSize: 18 }}>
                      ›
                    </Text>
                  </Pressable>
                ))
              )}
            </>
          ) : auth.busyProvider ? (
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
              {auth.providers.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => void auth.login(p.id).then((ok) => ok && loadOrders())}
                  style={styles.loginBtn}
                >
                  <Text style={styles.loginBtnText}>{providerLabel(p.id)}</Text>
                </Pressable>
              ))}
              <Text style={[styles.mutedText, { fontFamily: fonts.body, fontSize: 11 }]}>
                {t.signInOptional}
              </Text>
            </>
          )}
        </View>

        {/* Hours */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.hours}</Text>
          {dayKeys.map((key, i) => {
            const h = hours[key];
            const text =
              !h || h.closed || !h.open || !h.close ? t.closed : `${h.open} – ${h.close}`;
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
    </View>
  );
}

function LinkRow({ label, onPress }: { label: string; onPress: () => void }): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.linkRow}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={{ color: colors.inkSoft, fontFamily: fonts.body, fontSize: 18 }}>›</Text>
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
    backgroundColor: "rgba(90, 10, 10, 0.35)",
  },
  logo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cream },
  name: {
    color: colors.onRed,
    fontSize: 20,
    fontFamily: fonts.bodyHeavy,
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
  cardTitle: { color: colors.ink, fontSize: 15, fontFamily: fonts.bodyHeavy, marginBottom: 8 },
  langChip: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.cream,
  },
  langChipActive: { backgroundColor: colors.red, borderColor: colors.red },
  langChipText: { color: colors.ink, fontSize: 13, fontFamily: fonts.bodyBold },
  profileName: { color: colors.ink, fontSize: 15, fontFamily: fonts.bodyBold },
  profileMail: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 12, marginTop: 1 },
  signOut: { color: colors.red, fontSize: 13, fontFamily: fonts.bodyBold, marginTop: 8 },
  mutedText: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 13, marginBottom: 8 },
  loginBtn: {
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: "center",
    marginBottom: 8,
    backgroundColor: colors.cream,
  },
  loginBtnText: { color: colors.red, fontFamily: fonts.bodyHeavy, fontSize: 13 },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
  },
  orderNo: { color: colors.ink, fontFamily: fonts.bodyHeavy, fontSize: 14 },
  orderMeta: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 11, marginTop: 1 },
  orderTotal: { color: colors.red, fontFamily: fonts.bodyHeavy, fontSize: 13 },
  hoursRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  hoursDay: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 13 },
  hoursTime: { color: colors.ink, fontSize: 13, fontFamily: fonts.bodySemi },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  linkText: { color: colors.ink, fontSize: 14, fontFamily: fonts.bodySemi },
  footer: {
    color: colors.inkSoft,
    fontFamily: fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
});
