import React from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";
import { CHEVRON_FORWARD, colors, fonts, radius } from "./theme";
import { SHEET_MAX } from "./layout";

/**
 * The owner's menu — everything the restaurant can do that isn't a tab.
 *
 * It hangs off the burger in `BrandHeader`, which only exists while a
 * staff session does, so a guest device can never open it. Every job it
 * lists is done IN THE APP: the owner's device is the counter's device,
 * and a handover to the web dashboard was one more thing to log into
 * mid-service, so the rows here are the whole surface.
 */
export function OwnerMenuSheet({
  visible,
  onClose,
  onBoard,
  onManageMenu,
  onLoyalty,
  onRedeemGiftCard,
  onGiftCards,
  onIssues,
  onRating,
  onHours,
  onContact,
  onPassword,
  openIssues = 0,
}: {
  visible: boolean;
  onClose: () => void;
  onBoard: () => void;
  onManageMenu: () => void;
  onLoyalty: () => void;
  /** Take a gift card at the counter — the one job here that happens
   *  with a guest standing in front of the phone. */
  onRedeemGiftCard: () => void;
  /** The venue's gift-card book: what was sold, redeemed, outstanding. */
  onGiftCards: () => void;
  onIssues: () => void;
  /** The Google star line under the restaurant's name (P7-14). */
  onRating: () => void;
  /** The week the kitchen is open. */
  onHours: () => void;
  /** The numbers a guest can phone the restaurant on. */
  onContact: () => void;
  /** The owner's own sign-in password, changed in a sheet of its own. */
  onPassword: () => void;
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
          {/* `card-outline`, not another gift: Loyalty already owns the
              gift glyph above, and two identical icons in one column is
              how a cashier taps the wrong row mid-service. */}
          <Row
            icon="card-outline"
            label={t.ownerRedeemGiftCard}
            onPress={() => go(onRedeemGiftCard)}
          />
          <Row icon="pricetags-outline" label={t.ownerGiftCards} onPress={() => go(onGiftCards)} />
          <Row
            icon="alert-circle-outline"
            label={t.ownerIssues}
            badge={openIssues}
            onPress={() => go(onIssues)}
          />
          <Row icon="star-outline" label={t.ownerRating} onPress={() => go(onRating)} />
          <Row icon="time-outline" label={t.ownerHours} onPress={() => go(onHours)} />
          <Row icon="call-outline" label={t.ownerContact} onPress={() => go(onContact)} />
          <Row icon="key-outline" label={t.ownerPassword} onPress={() => go(onPassword)} />
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
    // Capped and centred on a tablet: a column of eight rows does not
    // get wider just because the glass did.
    width: "100%",
    maxWidth: SHEET_MAX,
    alignSelf: "center",
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
