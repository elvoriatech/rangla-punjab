import React from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useI18n } from "../i18n";
import { GOOGLE_NATIVE, useAuth } from "../auth";
import { GoogleButton } from "../google-button";
import { brand, colors, fonts, hero, logo, radius, scrim } from "../theme";

/**
 * The launch screen — the mockup's red Willkommen page, element for
 * element: wave artwork, logo medallion, serif wordmark, gold flourish,
 * the four-feature icon row, a second flourish, italic Willkommen +
 * tagline, then the two entries ("Bestellung Starten" → menu,
 * "Anmelden / Registrieren" → account). Shown on every cold start while
 * the menu loads; both buttons enable the moment it has.
 */

const ORNAMENT = require("../../assets/ornament.png");

function Feature({ icon, label }: { icon: React.ReactNode; label: string }): React.ReactElement {
  return (
    <View style={styles.feature}>
      {icon}
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

export function WelcomeScreen({
  ready,
  loadError,
  onRetry,
  onStart,
  onAccount,
}: {
  ready: boolean;
  loadError: boolean;
  onRetry: () => void;
  onStart: () => void;
  onAccount: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const auth = useAuth();

  // One tap to an account, right on the launch screen — native Google
  // where the build supports it, the browser device flow otherwise.
  async function startGoogle(): Promise<void> {
    if (auth.busyProvider) return;
    const outcome = await auth.loginWithGoogle();
    if (outcome === "unavailable") await auth.login("google");
  }

  return (
    <ImageBackground
      source={hero}
      style={styles.bg}
      resizeMode="cover"
      // The artwork is venue-generated, so its pixel size is unknown here;
      // pinning the inner image to the container keeps it a background instead
      // of letting its intrinsic width define the layout.
      imageStyle={{ width: "100%", height: "100%" }}
    >
      <View style={styles.scrim}>
        <View style={styles.logoRing}>
          <Image source={logo} style={styles.logo} />
        </View>
        <Text style={styles.brand}>{brand.name}</Text>
        <View style={styles.ruleRow}>
          <View style={styles.rule} />
          <Text style={styles.sub}>{t.restaurant}</Text>
          <View style={styles.rule} />
        </View>
        <Image source={ORNAMENT} style={styles.ornamentSmall} resizeMode="contain" />

        <View style={styles.featureRow}>
          <Feature
            icon={
              <MaterialCommunityIcons name="room-service-outline" size={26} color={colors.onRed} />
            }
            label={t.featCuisine}
          />
          <View style={styles.featureDivider} />
          <Feature
            icon={<Ionicons name="leaf-outline" size={24} color={colors.onRed} />}
            label={t.featFresh}
          />
          <View style={styles.featureDivider} />
          <Feature
            icon={
              <MaterialCommunityIcons name="pot-steam-outline" size={26} color={colors.onRed} />
            }
            label={t.featRecipes}
          />
          <View style={styles.featureDivider} />
          <Feature
            icon={<Ionicons name="heart-outline" size={24} color={colors.onRed} />}
            label={t.featLove}
          />
        </View>

        <Image source={ORNAMENT} style={styles.ornamentWide} resizeMode="contain" />

        <Text style={styles.welcome}>{t.welcome}</Text>
        <Text style={styles.tagline}>
          {t.taglineTop}
          {"\n"}
          {t.taglineBottom}
        </Text>

        {loadError ? (
          <>
            <Text style={styles.error}>{t.bootError}</Text>
            <Pressable onPress={onRetry} style={styles.secondaryBtn}>
              <Text style={styles.secondaryText}>{t.bootRetry}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={onStart}
              disabled={!ready}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            >
              {ready ? (
                <Text style={styles.primaryText}>{t.startOrdering}</Text>
              ) : (
                <ActivityIndicator color={colors.ink} />
              )}
            </Pressable>
            {auth.customer || !auth.googleAvailable ? null : (
              <View style={styles.googleSlot}>
                <GoogleButton
                  label={t.continueWithGoogle}
                  onPress={() => void startGoogle()}
                  disabled={!ready}
                  busy={auth.busyProvider === GOOGLE_NATIVE}
                />
              </View>
            )}
            <Pressable
              onPress={onAccount}
              disabled={!ready}
              style={({ pressed }) => [
                styles.secondaryBtn,
                (!ready || pressed) && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.secondaryText}>{t.signInRegister}</Text>
            </Pressable>
          </>
        )}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.red },
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: scrim,
  },
  logoRing: {
    width: 122,
    height: 122,
    borderRadius: 61,
    borderWidth: 2,
    borderColor: colors.goldSoft,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
    overflow: "hidden",
    marginBottom: 16,
  },
  logo: { width: 112, height: 112, borderRadius: 56 },
  brand: {
    color: colors.onRed,
    fontSize: 36,
    ...fonts.display,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 6,
  },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  rule: { width: 42, height: 1, backgroundColor: colors.goldSoft },
  sub: { color: colors.goldSoft, fontSize: 12, letterSpacing: 4, ...fonts.bodyBold },
  ornamentSmall: { width: 150, height: 28, marginTop: 10, opacity: 0.95 },
  featureRow: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    marginTop: 22,
  },
  feature: { flex: 1, alignItems: "center", gap: 6, paddingHorizontal: 3 },
  featureDivider: { width: 1, backgroundColor: "rgba(232,193,92,0.55)", marginVertical: 2 },
  featureLabel: {
    color: colors.onRed,
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
    ...fonts.bodySemi,
  },
  ornamentWide: { width: 220, height: 40, marginTop: 24, opacity: 0.95 },
  welcome: {
    color: colors.onRed,
    fontSize: 30,
    ...fonts.displayItalic,
    marginTop: 12,
  },
  tagline: {
    color: colors.goldSoft,
    ...fonts.body,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 32,
  },
  primaryBtn: {
    alignSelf: "stretch",
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryText: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 15, letterSpacing: 0.3 },
  googleSlot: { alignSelf: "stretch", marginTop: 12 },
  secondaryBtn: {
    alignSelf: "stretch",
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryText: { color: colors.onRed, ...fonts.bodyBold, fontSize: 14 },
  error: { color: colors.onRed, ...fonts.body, fontSize: 14, marginBottom: 12 },
});
