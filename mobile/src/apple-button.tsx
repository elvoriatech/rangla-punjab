import React from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

/**
 * "Sign in with Apple" — Apple's own button, never a lookalike: the
 * Human Interface Guidelines require the system control, which also
 * localises its own label to the phone's language. Sized to match
 * `GoogleButton` beside it, because App Store guideline 4.8 asks for an
 * EQUIVALENT option, and a smaller button is not one.
 *
 * iOS only; renders nothing where the module is absent (Android, web,
 * Expo Go).
 */

type AppleModule = typeof import("expo-apple-authentication");
function loadApple(): AppleModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-apple-authentication") as AppleModule;
  } catch {
    return null;
  }
}

export function AppleButton({
  onPress,
  busy,
  compact,
}: {
  onPress: () => void;
  busy?: boolean;
  /** The checkout card's tighter variant, as with GoogleButton. */
  compact?: boolean;
}): React.ReactElement | null {
  const mod = loadApple();
  if (!mod) return null;
  const height = compact ? 42 : 46;
  if (busy) {
    return (
      <View style={[styles.busy, { height, borderRadius: height / 2 }, !compact && styles.spaced]}>
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }
  return (
    <mod.AppleAuthenticationButton
      buttonType={mod.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={mod.AppleAuthenticationButtonStyle.BLACK}
      // Half the height: a pill like GoogleButton. The native control
      // does not clamp a larger radius the way CSS does.
      cornerRadius={height / 2}
      onPress={onPress}
      style={[{ width: "100%", height }, !compact && styles.spaced]}
    />
  );
}

const styles = StyleSheet.create({
  busy: {
    width: "100%",
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  spaced: { marginBottom: 8 },
});
