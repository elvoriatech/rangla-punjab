import React from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useI18n } from "../i18n";
import { GOOGLE_NATIVE, useAuth } from "../auth";
import { GoogleButton } from "../google-button";
import { HalalMark } from "../halal-mark";
import { venueNameLines } from "../venue-name";
import { brand, colors, fonts, hero, logo, radius, scrim } from "../theme";

/**
 * The launch screen — the mockup's red Willkommen page, element for
 * element: wave artwork, logo medallion, the venue's name over its town,
 * gold flourish, the four-feature icon row, a second flourish, italic
 * Willkommen + tagline, then the two entries ("Bestellung Starten" →
 * menu, "Anmelden / Registrieren" → account). A halal kitchen wears the
 * calligraphic mark in the top-left corner, over the scrim.
 *
 * It has TWO variants, and they are one component on purpose:
 *
 *  - `"start"` — the page above, for a device with no session.
 *  - `"loading"` — the same page, button-for-button identical down to
 *    the artwork, with a quiet spinner where the entries would be. It is
 *    what a device that is ALREADY signed in sees between launch and the
 *    menu arriving.
 *
 * The second used to be its own stripped-down screen, which meant the
 * owner's tablet opened onto something that did not look like the app.
 * Keeping them in one component is what stops them drifting again: every
 * change to the launch page is a change to both.
 *
 * The error + retry state belongs to both variants — a signed-in device
 * can perfectly well be the one that cannot reach the kitchen.
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
  variant = "start",
  ready = false,
  loadError,
  onRetry,
  onStart,
  onAccount,
}: {
  /** "loading" drops the two entries and shows a spinner instead.
   *  Everything else on the page is identical. */
  variant?: "start" | "loading";
  /** Whether the menu has arrived. Meaningless while loading, which is
   *  why it defaults rather than being required there. */
  ready?: boolean;
  loadError: boolean;
  onRetry: () => void;
  /** Required by the "start" variant; the loading one navigates nowhere
   *  because the shell decides where a signed-in device lands. */
  onStart?: () => void;
  onAccount?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const loading = variant === "loading";
  // "Rangla Punjab Restaurant" over "Konstanz" — one `venues.name` with
  // the " · " separator in it, set as a letterhead (see `venue-name.ts`).
  const { line1, line2 } = venueNameLines(brand.name);

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
      {/* Scrollable because this stack is taller than a phone laid on
          its side — and since P7 the app no longer locks to portrait.
          `flexGrow: 1` keeps it vertically centred whenever it does
          fit, which is every portrait phone and every tablet. */}
      <ScrollView
        style={styles.bg}
        contentContainerStyle={styles.scrim}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRing}>
          <Image source={logo} style={styles.logo} />
        </View>
        {/* The name must FIT BY CONSTRUCTION, not by shrinking: web has no
            `adjustsFontSizeToFit` at all and Android honours it unevenly, so
            a size that only just fits in the simulator is a size that
            ellipsises on a real phone. Two things buy the room — 24 pt
            instead of 28 (measured: "Rangla Punjab Restaurant" wants
            ~298 pt of Nunito 800 at 24), and `nameBlock`, which claws back
            half the scrim's 32 pt gutter either side. That is 328 pt of
            line on a 360 pt phone and 358 on a 390 pt one, against 298
            needed. `adjustsFontSizeToFit` stays as the device-side safety
            net for the venue whose name is longer still; it is no longer
            what THIS venue depends on. */}
        <View style={styles.nameBlock}>
          <Text style={styles.brand} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
            {line1}
          </Text>
          {line2 ? (
            <Text style={styles.brandPlace} numberOfLines={1}>
              {line2}
            </Text>
          ) : null}
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
            // The one green icon in the row, at the owner's word: the same
            // `colors.halal` the corner mark wears, so "fresh" and "halal"
            // read as one promise rather than two unrelated colours. Its
            // LABEL stays cream like the other three, so the strip still
            // scans as a set and the colour is never the only signal.
            icon={<Ionicons name="leaf-outline" size={24} color={colors.halal} />}
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
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={t.bootRetry}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryText}>{t.bootRetry}</Text>
            </Pressable>
          </>
        ) : loading ? (
          // Where the two entries would be. Deliberately quiet: this
          // page is on screen for a moment, and a device with a session
          // has already made the choice those buttons offer.
          <View style={styles.loadingSlot} accessibilityRole="progressbar">
            <ActivityIndicator color={colors.goldSoft} />
            <Text style={styles.loadingText}>{t.bootLoading}</Text>
          </View>
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
      </ScrollView>
      {/* The owner's mock: the mark in the top-left corner, over the red,
          clear of the notch. Absolute and OUTSIDE the ScrollView, so it
          stays put while a short phone scrolls the stack underneath it,
          and `pointerEvents="none"` so it never eats a tap meant for the
          page. `left` rather than `start`: the corner is the corner in
          both reading directions — this is artwork, not a control. */}
      {brand.halal ? (
        <View style={[styles.halal, { top: insets.top + 14 }]} pointerEvents="none">
          <HalalMark />
        </View>
      ) : null}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.red },
  scrim: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
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
  /**
   * The venue's name, and the town under it.
   *
   * NUNITO, not the display serif — the same `bodyHeavy` face and the
   * same soft shadow as the profile heading on the Account screen, at the
   * owner's word: the two places the restaurant's own name is set should
   * be one typeface, and the old display serif at 36 was reading as a
   * wordmark rather than as the name of a place. The app has since gone
   * to that one face everywhere (see `theme.ts`), so this is no longer
   * the exception it was — it is simply the heading ramp's top end. The "— RESTAURANT —" rule row that used
   * to sit here is gone with it; the town says what the rule said, and
   * says something true about THIS restaurant rather than a generic word.
   */
  /**
   * The name's own measure, WIDER than the rest of the page.
   *
   * The scrim insets everything by 32 pt, which is right for the buttons
   * and the tagline but costs the one string that cannot afford it; a
   * -16 margin hands half of each gutter back. Nothing else on the page
   * moves, because only this block opts out.
   *
   * It has to be a VIEW and not the margin on the Text itself: every
   * react-native-web `Text` carries a base `max-width: 100%`, which
   * silently clamps a negatively-margined text box straight back to the
   * parent's padding box — measured, on the build this shipped from. A
   * View has no such rule, and the Texts inside then stretch to IT.
   */
  nameBlock: { alignSelf: "stretch", marginHorizontal: -16 },
  brand: {
    color: colors.onRed,
    fontSize: 24,
    ...fonts.bodyHeavy,
    /** Zero, stated: tracking is what pushed the name past the measure,
     *  and the town under it carries the letter-spaced look for the pair. */
    letterSpacing: 0,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 6,
  },
  /** The locality: smaller, tracked out, the quiet half of the pair. It
   *  shares the name's wider measure so the two lines are centred on the
   *  same axis rather than on two different ones. */
  brandPlace: {
    color: colors.onRed,
    fontSize: 15,
    ...fonts.bodyBold,
    letterSpacing: 2.5,
    marginTop: 2,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 5,
  },
  /** Top-left corner, clear of the notch (`top` is set inline from the
   *  safe-area inset).
   *
   *  The mark is ROTATED -18° about its own centre, which pushes its
   *  painted corners ~8 pt further out than the layout box on every
   *  side. `left: 20` and the +14 on the inset are what keep those
   *  corners inside the screen and off the status bar; the un-rotated
   *  box therefore sits a little in from where a square mark would.
   *  See the mark itself in `halal-mark.tsx`. */
  halal: { position: "absolute", left: 20 },
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
  // Occupies roughly the height the buttons would, so the page does not
  // visibly reflow when a guest device shows them instead.
  loadingSlot: { alignSelf: "stretch", alignItems: "center", gap: 10, paddingVertical: 14 },
  loadingText: { color: colors.goldSoft, ...fonts.bodySemi, fontSize: 13 },
});
