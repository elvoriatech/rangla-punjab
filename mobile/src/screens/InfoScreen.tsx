import React from "react";
import {
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
import { colors, radius } from "../theme";

/**
 * Info — restaurant identity, opening hours, and the web links. There
 * are deliberately no accounts in this app: ordering needs none, and a
 * guest's history lives on their own device.
 */
export function InfoScreen({ menu }: { menu: ApiMenu }): React.ReactElement {
  const hours = (menu.venue.hours ?? {}) as Record<
    string,
    { open?: string; close?: string; closed?: boolean } | undefined
  >;
  const days: { key: string; label: string }[] = [
    { key: "mon", label: "Montag" },
    { key: "tue", label: "Dienstag" },
    { key: "wed", label: "Mittwoch" },
    { key: "thu", label: "Donnerstag" },
    { key: "fri", label: "Freitag" },
    { key: "sat", label: "Samstag" },
    { key: "sun", label: "Sonntag" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ImageBackground source={require("../../assets/artwork.jpg")} style={styles.hero}>
        <View style={styles.heroOverlay}>
          <Image source={require("../../assets/rangla-logo.png")} style={styles.logo} />
          <Text style={styles.name}>{menu.venue.name}</Text>
          <Text style={styles.tagline}>Authentischer Geschmack · Traditionelle Rezepte</Text>
        </View>
      </ImageBackground>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Öffnungszeiten</Text>
          {days.map((d) => {
            const h = hours[d.key];
            const text =
              !h || h.closed || !h.open || !h.close ? "geschlossen" : `${h.open} – ${h.close}`;
            return (
              <View key={d.key} style={styles.hoursRow}>
                <Text style={styles.hoursDay}>{d.label}</Text>
                <Text style={styles.hoursTime}>{text}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mehr</Text>
          <LinkRow label="Speisekarte im Web" onPress={() => void Linking.openURL(BASE_URL)} />
          <LinkRow
            label="Impressum"
            onPress={() => void Linking.openURL(`${BASE_URL}/legal/impressum`)}
          />
          <LinkRow
            label="Datenschutz"
            onPress={() => void Linking.openURL(`${BASE_URL}/legal/privacy`)}
          />
        </View>

        <Text style={styles.footer}>Traditionelle Rezepte mit Liebe serviert 🌿</Text>
      </ScrollView>
    </View>
  );
}

function LinkRow({ label, onPress }: { label: string; onPress: () => void }): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.linkRow}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={{ color: colors.inkSoft, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { height: 190 },
  heroOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(90, 10, 10, 0.35)",
  },
  logo: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.cream },
  name: {
    color: colors.onRed,
    fontSize: 22,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 5,
  },
  tagline: {
    color: colors.goldSoft,
    fontSize: 12,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 4,
  },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: "800", marginBottom: 8 },
  hoursRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  hoursDay: { color: colors.inkSoft, fontSize: 13 },
  hoursTime: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  linkText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  footer: { color: colors.inkSoft, fontSize: 12, textAlign: "center", marginTop: 8 },
});
