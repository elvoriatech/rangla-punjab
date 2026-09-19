import React from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BASE_URL } from "./api";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";
import { openInAppBrowser } from "./payments";
import { CHEVRON_FORWARD, colors, fonts, radius } from "./theme";

/** How long to wait for an `onDismiss` that only iOS ever sends. Long
 *  enough to cover the slide-out (~300 ms), short enough that Android
 *  feels immediate. */
const DISMISS_FALLBACK_MS = 350;

/**
 * The owner's menu — everything the restaurant can do that isn't a tab.
 *
 * It hangs off the burger in `BrandHeader`, which only exists while a
 * staff session does, so a guest device can never open it. The jobs it
 * lists are the ones the counter needs on the phone; anything that wants
 * a keyboard (dish text, photos, opening hours, the loyalty settings)
 * hands over to the dashboard in an in-app browser rather than growing a
 * cramped mobile form for it.
 */
export function OwnerMenuSheet({
  visible,
  onClose,
  onBoard,
  onManageMenu,
  onLoyalty,
  onIssues,
  openIssues = 0,
}: {
  visible: boolean;
  onClose: () => void;
  onBoard: () => void;
  onManageMenu: () => void;
  onLoyalty: () => void;
  onIssues: () => void;
  /** Unresolved complaints; 0 hides the badge entirely. */
  openIssues?: number;
}): React.ReactElement {
  const { t } = useI18n();
  const { logoutStaff } = useAuth();

  // Same confirm as the Account screen's: signing out takes the live
  // board off the counter's phone, which is not a mis-tap's to decide.
  const confirmSignOut = (): void => {
    Alert.alert(t.signOutStaff, undefined, [
      { text: t.signInCancel, style: "cancel" },
      {
        text: t.signOut,
        style: "destructive",
        onPress: () => {
          onClose();
          void logoutStaff();
        },
      },
    ]);
  };

  // Tab switches are pure React state: closing the sheet and switching in
  // the same tick is fine, because nothing native is presented.
  const go = (action: () => void): void => {
    onClose();
    action();
  };

  /**
   * Anything that presents a NATIVE screen (the in-app browser) must wait
   * for this sheet's own view controller to finish going away.
   *
   * Presenting SFSafariViewController while the `<Modal>` is mid-dismissal
   * leaves iOS with a stale presented layer that swallows every touch —
   * the app looks frozen until it is force-quit. So the action is parked
   * in a ref, `onClose()` starts the slide-out, and the ref is run from
   * `onDismiss` (iOS, fires once the animation is done). Android never
   * fires `onDismiss`, hence the timer; whichever arrives first wins and
   * cancels the other, so the action runs exactly once.
   */
  const pending = React.useRef<(() => void) | null>(null);
  const fallback = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPending = React.useCallback((): void => {
    if (fallback.current !== null) {
      clearTimeout(fallback.current);
      fallback.current = null;
    }
    const action = pending.current;
    pending.current = null;
    action?.();
  }, []);

  // Unmounting (signing out drops the whole owner UI) must not fire a
  // queued action into a tree that is no longer there.
  React.useEffect(
    () => () => {
      if (fallback.current !== null) clearTimeout(fallback.current);
      fallback.current = null;
      pending.current = null;
    },
    [],
  );

  const goAfterDismiss = (action: () => void): void => {
    // A second tap while one is already queued is a no-op, not a second
    // present.
    if (pending.current !== null) return;
    pending.current = action;
    onClose();
    fallback.current = setTimeout(runPending, DISMISS_FALLBACK_MS);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{t.ownerMenuTitle}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <Row icon="restaurant-outline" label={t.ownerBoard} onPress={() => go(onBoard)} />
          <Row
            icon="fast-food-outline"
            label={t.ownerMenuManage}
            onPress={() => go(onManageMenu)}
          />
          <Row icon="gift-outline" label={t.ownerLoyalty} onPress={() => go(onLoyalty)} />
          <Row
            icon="alert-circle-outline"
            label={t.ownerIssues}
            badge={openIssues}
            onPress={() => go(onIssues)}
          />
          <Row
            icon="open-outline"
            label={t.ownerDashboard}
            onPress={() => goAfterDismiss(() => void openInAppBrowser(`${BASE_URL}/dashboard`))}
          />
          <View style={styles.rule} />
          <Row icon="log-out-outline" label={t.signOutStaff} danger onPress={confirmSignOut} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onPress,
  danger,
  badge = 0,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** A count of work waiting behind this row. 0 renders nothing. */
  badge?: number;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label} (${badge})` : label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: "#fdeee6" }]}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.red} />
      <Text style={[styles.rowText, danger && { color: colors.danger }]}>{label}</Text>
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99" : badge}</Text>
        </View>
      ) : null}
      {danger ? null : <Text style={styles.chevron}>{CHEVRON_FORWARD}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
    gap: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: { color: colors.ink, ...fonts.display, fontSize: 22 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // A counter taps this with a thumb, often one-handed.
    minHeight: 52,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  rowText: { flex: 1, color: colors.ink, ...fonts.bodyBold, fontSize: 15.5 },
  chevron: { color: colors.inkSoft, ...fonts.body, fontSize: 18 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  badge: {
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.onRed, fontSize: 11, ...fonts.bodyHeavy },
});
