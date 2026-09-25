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
  useWindowDimensions,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { VenueWordmark } from "../venue-wordmark";
import { useI18n } from "../i18n";
import { GOOGLE_NATIVE, useAuth } from "../auth";
import { GoogleButton } from "../google-button";
import { HalalMark } from "../halal-mark";
import { displayVenueName, venueNameLines } from "../venue-name";
import { brand, colors, fonts, hero, radius, scrim } from "../theme";
import { useLayout } from "../layout";
import { Row } from "../responsive";

/**
 * The launch screen — the mockup's red Willkommen page, element for
 * element: wave artwork, the mascot on the red, the venue's lockup
 * over its town,
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
/** The venue mascot with its white card removed — see the note at the
 *  launch screen's logo, and `scripts/cut-out-logo.mjs`. */
const LOGO_CUTOUT = require("../../assets/logo-cutout.png");

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
  const { wide, content: column } = useLayout();
  const auth = useAuth();
  const loading = variant === "loading";
  // "Rangla Punjab Restaurant" over "Konstanz" — one `venues.name` with
  // the " · " separator in it, set as a letterhead (see `venue-name.ts`).
  const { line1, line2 } = venueNameLines(displayVenueName());
  /** The mark's measure: the window less a margin of its own — narrower
   *  than the page's text so the lockup has air either side, as it does
   *  on the posters, and 32 pt narrower again since the owner asked for
   *  the top line 5 pt smaller (2026-09-22; the mark is fitted to THIS,
   *  so its width is what sets the lettering's size). Capped at 390 so a
   *  tablet gets a letterhead rather than a shop sign. Live across
   *  rotations, because this screen scrolls and does not lock to
   *  portrait. */
  const nameWidth = Math.min(390, Math.max(160, useWindowDimensions().width - 88));

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
        {/* The mascot, straight on the red — no medallion, no white card
            (owner, 2026-09-22: "there is no background of logo"). The
            generated logo is drawn ON a white square, so the launch
            screen uses the cut-out made from it by
            `scripts/cut-out-logo.mjs`; everywhere the logo sits on a
            light surface (the header, the Account hero) keeps the
            generated one. */}
        <Image source={LOGO_CUTOUT} style={styles.logo} resizeMode="contain" />
        {/* The venue's own LOCKUP — "RANGLA PUNJAB" over a smaller
            "RESTAURANT", in the lime sticker lettering, exactly as the
            owner's posters set it (see `venue-wordmark.tsx`, whose
            proportions are measured off those posters).

            It is set past any phone's measure and fitted to it by the
            mark's own `maxWidth`, which scales the whole thing — glyphs,
            strokes, tracking and the artwork's condensed width together,
            so it spans the page on every phone — rather
            than relying on `adjustsFontSizeToFit`, which web does not
            implement at all and Android honours unevenly.

            The measure is the window less the scrim's 32 pt gutters, plus
            the 16 pt either side that `nameBlock` claws back. */}
        <View style={styles.nameBlock}>
          <VenueWordmark name={line1} size={64} maxWidth={nameWidth} />
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
          (() => {
            const start = (
              <Pressable
                key="start"
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
            );
            const google =
              auth.customer || !auth.googleAvailable ? null : (
                <View key="google" style={wide ? null : styles.googleSlot}>
                  <GoogleButton
                    label={t.continueWithGoogle}
                    onPress={() => void startGoogle()}
                    disabled={!ready}
                    busy={auth.busyProvider === GOOGLE_NATIVE}
                  />
                </View>
              );
            const account = (
              <Pressable
                key="account"
                onPress={onAccount}
                disabled={!ready}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  wide && { marginTop: 0 },
                  (!ready || pressed) && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.secondaryText}>{t.signInRegister}</Text>
              </Pressable>
            );
            // A tablet: one line, the way forward on the right, in the
            // reading column rather than across the whole glass.
            return wide ? (
              <View style={[column, { alignSelf: "center" }]}>
                <Row>
                  {account}
                  {google}
                  {start}
                </Row>
              </View>
            ) : (
              <>
                {start}
                {google}
                {account}
              </>
            );
          })()
        )}
      </ScrollView>
      {/* The owner's mock: the mark in the top-left corner, over the red,
          clear of the notch. Absolute and OUTSIDE the ScrollView, so it
          stays put while a short phone scrolls the stack underneath it,
          and `pointerEvents="none"` so it never eats a tap meant for the
          page. `left` rather than `start`: the corner is the corner in
          both reading directions — this is artwork, not a control. */}
      {brand.halal ? (
        // The app's root SafeAreaView already starts this screen below the
        // status bar, so the mark sits just inside the red — adding
        // `insets.top` again dropped it a whole status bar too low.
        <View style={[styles.halal, { top: 10 }]} pointerEvents="none">
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
  /** Bigger than the old 112 pt medallion, because there is no ring
   *  around it any more and the mascot is the page's first image. */
  logo: { width: 168, height: 168, marginBottom: 4 },
  /**
   * The venue's name, and the town under it.
   *
   * The name is the STICKER lettering now (owner, 2026-09-22) — the lime,
   * outlined face off the logo, the same one the POINTS badge wears, so
   * the restaurant's name is set in the restaurant's own letters wherever
   * it appears. It was Nunito 800 before that, and a display serif before
   * that; the town underneath keeps the app's body face, which is what
   * holds the pair together as a letterhead rather than two logos.
   *
   * The name's own measure is WIDER than the rest of the page.
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
  /** `alignItems: center` because the sticker lettering sizes its own box
   *  (it is an SVG, not a Text that fills the line) — without it the box
   *  would sit at the start of the stretched block. */
  nameBlock: { alignSelf: "stretch", alignItems: "center", marginHorizontal: -16 },
  /** The locality: smaller, tracked out, the quiet half of the pair — and
   *  PURE WHITE, a weight heavier than the cream it used to be (owner,
   *  2026-09-22), so it holds its own under the lime lettering instead of
   *  fading into the red. It shares the name's wider measure so the two
   *  lines are centred on the same axis rather than on two different ones. */
  brandPlace: {
    color: "#FFFFFF",
    fontSize: 16,
    ...fonts.bodyHeavy,
    letterSpacing: 2.5,
    marginTop: 4,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowRadius: 5,
  },
  /** Top-left corner, clear of the notch (`top` is set inline from the
   *  safe-area inset).
   *
   *  The mark is set straight (owner, 2026-09-21); `left: 20` and the
   *  +14 on the inset keep it inside the screen and off the status bar.
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
