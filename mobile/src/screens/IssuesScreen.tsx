import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../auth";
import type { StaffIssueSummary } from "../staff";
import { fetchStaffIssues } from "../staff";
import { BrandHeader } from "../components";
import { IssueSheet, relativeTime } from "../issue-sheet";
import { useI18n } from "../i18n";
import { CHEVRON_FORWARD, colors, fonts, radius } from "../theme";

/**
 * Every complaint a guest has opened, newest activity first — the
 * restaurant's work queue for the things that went wrong.
 *
 * Unresolved only by default: a list that also carried months of settled
 * complaints would stop being a queue. "Show resolved" is the archive,
 * one tap away, and the toggle refetches rather than filtering locally
 * (the server decides what "resolved" means, and older threads are not
 * in the default payload at all).
 *
 * Reached from the owner's burger like the loyalty overview, with its own
 * back arrow — it is not a tab.
 */
export function IssuesScreen({
  onBack,
  onOpenOwnerMenu,
}: {
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const [issues, setIssues] = useState<StaffIssueSummary[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const statusLabels = t.issueStatusLabels as Record<string, string>;

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffIssues(staffToken, showResolved);
    setLoaded(true);
    if (res.ok) {
      setIssues(res.data);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    // Keep whatever is on screen: a stale list beats an empty one.
    else setFailed(true);
  }, [staffToken, clearStaff, showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.issuesTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.red}
          />
        }
      >
        <Pressable
          onPress={() => {
            setLoaded(false);
            setShowResolved((on) => !on);
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: showResolved }}
          accessibilityLabel={t.issuesShowResolved}
          style={({ pressed }) => [
            styles.toggle,
            showResolved && styles.toggleOn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.toggleText, showResolved && styles.toggleTextOn]}>
            {showResolved ? "☑" : "☐"} {t.issuesShowResolved}
          </Text>
        </Pressable>

        {failed ? <Text style={styles.failed}>{t.staffLoadFailed}</Text> : null}

        {!loaded ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : issues.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ ...fonts.body, fontSize: 36 }}>🙂</Text>
            <Text style={styles.emptyTitle}>
              {showResolved ? t.issuesEmpty : t.issuesEmptyOpen}
            </Text>
          </View>
        ) : (
          issues.map((issue) => {
            const resolved = issue.status === "resolved";
            const preview = issue.lastMessage;
            return (
              <Pressable
                key={issue.id}
                onPress={() => setOpenId(issue.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t.issuePill} ${t.orderNo} ${issue.orderNumber}`}
                style={({ pressed }) => [
                  styles.card,
                  resolved && styles.cardResolved,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={{ flex: 1, gap: 5 }}>
                  <View style={styles.topRow}>
                    <View
                      style={[styles.pill, resolved ? styles.pillDone : styles.pillProblem]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          resolved ? styles.pillTextDone : styles.pillTextProblem,
                        ]}
                        numberOfLines={1}
                      >
                        {statusLabels[issue.status] ?? issue.status}
                      </Text>
                    </View>
                    <Text style={styles.number}>
                      #{String(issue.orderNumber).padStart(4, "0")}
                    </Text>
                    <Text style={styles.name} numberOfLines={1}>
                      {issue.customerName ?? t.issueGuest}
                    </Text>
                  </View>
                  {preview ? (
                    <Text style={styles.preview} numberOfLines={2}>
                      {preview.author === "guest" ? t.issueGuest : t.issueRestaurantLabel}:{" "}
                      {preview.body}
                    </Text>
                  ) : null}
                  <Text style={styles.time}>
                    {relativeTime(preview?.createdAt ?? issue.updatedAt, t)}
                  </Text>
                </View>
                <Text style={styles.chevron}>{CHEVRON_FORWARD}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <IssueSheet
        target={openId && staffToken ? { mode: "staff", token: staffToken, issueId: openId } : null}
        onClose={() => setOpenId(null)}
        // A reply or a resolve reorders the queue and may drop a row out
        // of it entirely — re-read rather than patching one card.
        onChanged={() => void load()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.creamCard,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  toggleOn: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  toggleText: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13 },
  toggleTextOn: { color: colors.red, ...fonts.bodyBold },
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 34,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { color: colors.ink, fontSize: 15.5, ...fonts.bodyBold, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  /** Settled: still readable, no longer asking for attention. */
  cardResolved: { backgroundColor: colors.cream, opacity: 0.8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  number: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 15 },
  name: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13, flexShrink: 1 },
  preview: { color: colors.ink, ...fonts.body, fontSize: 13, lineHeight: 18 },
  time: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
  chevron: { color: colors.inkSoft, ...fonts.body, fontSize: 22 },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  pillText: { fontSize: 11.5, ...fonts.bodyBold },
  pillProblem: { backgroundColor: "#fdeee6", borderColor: colors.danger },
  pillTextProblem: { color: colors.danger },
  pillDone: { backgroundColor: "#e9f3e4", borderColor: "#3f7030" },
  pillTextDone: { color: "#3f7030" },
});
