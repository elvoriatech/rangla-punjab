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
import { useI18n } from "../i18n";
import { colors, radius } from "../theme";

/**
 * The launch screen — the mockup's red Willkommen page: wave artwork,
 * logo medallion, brand wordmark, tagline, and the two entries
 * ("Bestellung Starten" → menu, "Anmelden / Registrieren" → account).
 * Shown on every cold start while the menu loads; both buttons enable
 * the moment it has.
 */
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
  const { t, lang } = useI18n();
  const de = lang === "de";
  return (
    <ImageBackground source={require("../../assets/artwork.jpg")} style={styles.bg}>
      <View style={styles.scrim}>
        <View style={styles.logoRing}>
          <Image source={require("../../assets/rangla-logo.png")} style={styles.logo} />
        </View>
        <Text style={styles.brand}>Rangla Punjab</Text>
        <View style={styles.ruleRow}>
          <View style={styles.rule} />
          <Text style={styles.sub}>{t.restaurant}</Text>
          <View style={styles.rule} />
        </View>

        <Text style={styles.welcome}>{de ? "Willkommen" : "Welcome"}</Text>
        <Text style={styles.tagline}>
          {de ? "Authentischer Geschmack" : "Authentic taste"}
          {"\n"}
          {de ? "Traditionelle Rezepte" : "Traditional recipes"}
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
                <Text style={styles.primaryText}>
                  {de ? "Bestellung Starten" : "Start ordering"}
                </Text>
              ) : (
                <ActivityIndicator color={colors.ink} />
              )}
            </Pressable>
            <Pressable
              onPress={onAccount}
              disabled={!ready}
              style={({ pressed }) => [
                styles.secondaryBtn,
                (!ready || pressed) && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.secondaryText}>
                {de ? "Anmelden / Registrieren" : "Sign in / Register"}
              </Text>
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
    backgroundColor: "rgba(110, 14, 14, 0.45)",
  },
  logoRing: {
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 2,
    borderColor: colors.goldSoft,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
    marginBottom: 18,
  },
  logo: { width: 104, height: 104, borderRadius: 52 },
  brand: {
    color: colors.onRed,
    fontSize: 34,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 6,
  },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  rule: { width: 42, height: 1, backgroundColor: colors.goldSoft },
  sub: { color: colors.goldSoft, fontSize: 12, letterSpacing: 4, fontWeight: "700" },
  welcome: {
    color: colors.onRed,
    fontSize: 26,
    fontWeight: "700",
    fontStyle: "italic",
    marginTop: 42,
  },
  tagline: {
    color: colors.goldSoft,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 36,
  },
  primaryBtn: {
    alignSelf: "stretch",
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryText: { color: colors.ink, fontWeight: "800", fontSize: 15, letterSpacing: 0.3 },
  secondaryBtn: {
    alignSelf: "stretch",
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryText: { color: colors.onRed, fontWeight: "700", fontSize: 14 },
  error: { color: colors.onRed, fontSize: 14, marginBottom: 12 },
});
