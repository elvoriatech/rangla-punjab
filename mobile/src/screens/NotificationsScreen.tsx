import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { BrandHeader } from "../components";
import { localeTag, useI18n } from "../i18n";
import { useLayout } from "../layout";
import type { StaffNotification } from "../staff";
import { fetchStaffNotifications, markStaffNotificationsSeen } from "../staff";
import { colors, fonts, radius } from "../theme";

/**
 * The bell's list (owner, 2026-10-14): every notification this login may
 * see — new orders, guest cancellations, complaints, table and catering
 * requests — newest first, the unseen ones marked. Opening the screen
 * marks them all seen (the bell's number goes to 0); tapping one goes to
 * the screen it is about, exactly like tapping the push itself.
 */

const ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  order: "receipt-outline",
  issue: "alert-circle-outline",
  reservation: "calendar-outline",
  catering: "wine-outline",
};

export function NotificationsScreen({
  onBack,
  onOpenOwnerMenu,
  onOpen,
  onSeen,
}: {
  onBack?: () => void;
  onOpenOwnerMenu?: () => void;
  /** Go where the notification points (same as a tapped push). */
  onOpen: (data: Record<string, string>) => void;
  /** The bell's count is now 0 — refresh it. */
  onSeen?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const tag = localeTag(lang);
  const [items, setItems] = useState<StaffNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Through a ref: the parent's callback is a fresh function each render,
  // and reloading on it would re-fetch with everything already "seen".
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffNotifications(staffToken);
    if (res.ok) {
      setItems(res.data.items);
      setFailed(false);
      // Seen now: the highlight stays on this visit, the count goes to 0.
      if (res.data.unread > 0) {
        await markStaffNotificationsSeen(staffToken);
        onSeenRef.current?.();
      }
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    else setFailed(true);
  }, [staffToken, clearStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  const when = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString(tag, {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.notificationsTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 40,
          gap: 10,
          ...layout.content,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.red}
          />
        }
      >
        {items === null ? (
          failed ? (
            <Text style={styles.failed}>{t.staffLoadFailed}</Text>
          ) : (
            <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
          )
        ) : items.length === 0 ? (
          <Text style={styles.empty}>{t.notificationsEmpty}</Text>
        ) : (
          items.map((n) => (
            <Pressable
              key={n.id}
              onPress={() => onOpen(n.data)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.card,
                n.unseen && styles.cardUnseen,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.icon, n.unseen && styles.iconUnseen]}>
                <Ionicons
                  name={ICON[n.kind] ?? "notifications-outline"}
                  size={20}
                  color={n.unseen ? colors.onRed : colors.ink}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {n.title}
                </Text>
                <Text style={styles.body} numberOfLines={2}>
                  {n.body}
                </Text>
              </View>
              <Text style={styles.time}>{when(n.createdAt)}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 14, textAlign: "center", marginTop: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 12,
  },
  cardUnseen: { borderColor: colors.red, borderWidth: 1.5 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  iconUnseen: { backgroundColor: colors.red },
  title: { color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
  body: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  time: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12, alignSelf: "flex-start" },
});
