import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PickedPhoto } from "./photo";
import { askPhotoSource, pickPhoto } from "./photo";
import type { ApiIssue } from "./api";
import { fetchIssue, postIssueMessage } from "./api";
import type { StaffIssue } from "./staff";
import { fetchStaffIssue, replyStaffIssue, resolveStaffIssue } from "./staff";
import { useAuth } from "./auth";
import { fill, localeTag, useI18n } from "./i18n";
import { FieldLabel, RequiredLegend } from "./components";
import { colors, fonts, radius } from "./theme";

/**
 * The complaint thread on ONE order (P7-10), as a hand-rolled sheet —
 * there is no Sheet primitive in this app, so it follows `dish-sheet.tsx`:
 * a transparent `<Modal>`, a dimmed tap-away backdrop, and a panel that
 * swallows its own touches.
 *
 * The same component serves both people, because it is the same
 * conversation:
 *
 *  - **guest** — authorised by the receipt token this device holds.
 *    Opens the thread with the first message, may attach one photo per
 *    message, and goes read-only the moment the restaurant resolves it.
 *  - **staff** — authorised by the staff session. Replies (text only, as
 *    the API takes) and can mark the complaint resolved.
 *
 * The layout is RTL-safe by construction: nothing is positioned left or
 * right, only `flex-start`/`flex-end` and `start`/`end` edges, which Yoga
 * mirrors for an Arabic build.
 */

/** 5 MB — `MAX_ISSUE_PHOTO_BYTES` on the server. Checked here too so an
 *  over-size photo is refused before it is uploaded. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** `ISSUE_BODY_MAX` on the server. */
const BODY_MAX = 2000;

export type IssueTarget =
  | { mode: "guest"; orderId: string; token: string }
  | { mode: "staff"; token: string; issueId: string };

/** One message, however it arrived — the two APIs describe the same row. */
interface ThreadMessage {
  id: string;
  author: "guest" | "restaurant";
  body: string;
  photoUrl: string | null;
  createdAt: string;
}

interface Thread {
  status: string;
  messages: ThreadMessage[];
  /** Staff mode only: enough of the order to know whose complaint it is. */
  order?: { number: number; name: string | null } | null;
}

function toThread(issue: ApiIssue): Thread {
  return { status: issue.status, messages: issue.messages };
}

function staffToThread(issue: StaffIssue): Thread {
  return {
    status: issue.status,
    messages: issue.messages,
    order: { number: issue.orderNumber, name: issue.customerName },
  };
}

/**
 * "just now" / "12 min ago" / "3 h ago" / "2 d ago" — a thread is read by
 * how fresh it is, and an absolute timestamp makes the reader do that
 * arithmetic themselves. Shared with the complaints list.
 */
export function relativeTime(
  iso: string,
  t: {
    issueJustNow: string;
    issueMinutesAgo: string;
    issueHoursAgo: string;
    issueDaysAgo: string;
  },
): string {
  const then = new Date(iso).getTime();
  if (!iso || Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return t.issueJustNow;
  if (mins < 60) return fill(t.issueMinutesAgo, { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fill(t.issueHoursAgo, { n: hours });
  return fill(t.issueDaysAgo, { n: Math.floor(hours / 24) });
}

export function IssueSheet({
  target,
  onClose,
  onChanged,
}: {
  /** Null keeps the modal closed — same shape as `DishSheet`'s `item`. */
  target: IssueTarget | null;
  onClose: () => void;
  /** The thread's status after anything was written, so the screen that
   *  opened the sheet can update its pill without another round trip.
   *  Null means "still no thread". */
  onChanged?: (status: string | null) => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { clearStaff } = useAuth();
  const insets = useSafeAreaInsets();
  const tag = localeTag(lang);

  const [thread, setThread] = useState<Thread | null>(null);
  const [canReport, setCanReport] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The photo the reader tapped, shown full-size over the sheet. */
  const [viewer, setViewer] = useState<string | null>(null);
  /** True while the system picker is up, so a double tap cannot ask iOS
   *  to present a second one on top of the first. */
  const picking = useRef(false);

  const statusLabels = t.issueStatusLabels as Record<string, string>;
  const errorLabels = t.issueErrors as Record<string, string>;

  // Staff photos are behind the staff token: the image request carries it
  // as a header, exactly like every other staff call.
  const photoHeaders = target?.mode === "staff" ? { "X-Staff-Token": target.token } : undefined;

  const key = target
    ? target.mode === "guest"
      ? `guest:${target.orderId}`
      : `staff:${target.issueId}`
    : "";

  const load = useCallback(async (): Promise<void> => {
    if (!target) return;
    setFailed(false);
    if (target.mode === "guest") {
      const state = await fetchIssue(target.orderId, target.token);
      setLoaded(true);
      if (!state) {
        setFailed(true);
        return;
      }
      setCanReport(state.canReport);
      setThread(state.issue ? toThread(state.issue) : null);
      return;
    }
    const res = await fetchStaffIssue(target.token, target.issueId);
    setLoaded(true);
    if (res.ok) {
      setThread(staffToThread(res.data));
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      onClose();
      return;
    }
    setFailed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the target
  }, [key, clearStaff, onClose]);

  // A fresh target is a fresh conversation: nothing about the previous
  // one (draft, photo, error) may survive into it.
  useEffect(() => {
    if (!target) return;
    setThread(null);
    setCanReport(false);
    setLoaded(false);
    setFailed(false);
    setDraft("");
    setPhoto(null);
    setError(null);
    setViewer(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the target
  }, [key]);

  const resolved = thread?.status === "resolved";
  // The guest may write while a thread is open, or open one inside the
  // window. The restaurant may always write, even on a resolved thread.
  const canWrite = target?.mode === "staff" ? Boolean(thread) : thread ? !resolved : canReport;
  const windowClosed = target?.mode === "guest" && !thread && !canReport && loaded && !failed;

  /**
   * Ask where the photo should come from, then take it there.
   *
   * A guest reporting a cold curry is standing over it — the camera is
   * the obvious source and used to be unreachable, so the action offers
   * both and the library stays the second option rather than the only
   * one. The picking itself (permissions, the size cap, normalising an
   * HEIC to JPEG) is shared with the owner's dish photo in `photo.ts`.
   */
  function choosePhotoSource(): void {
    if (picking.current) return;
    askPhotoSource(
      {
        title: t.issueAddPhoto,
        camera: t.issuePhotoCamera,
        library: t.issuePhotoLibrary,
        cancel: t.signInCancel,
      },
      (source) => void takePhoto(source),
    );
  }

  async function takePhoto(source: "camera" | "library"): Promise<void> {
    // NOTE: this presents the system picker while the sheet is still
    // VISIBLE, which is safe — iOS is happy to stack a presenter on a
    // settled modal. What is NOT safe is closing the sheet and
    // presenting in the same tick (see `owner-menu.tsx`), so nothing on
    // this path calls `onClose()`.
    if (picking.current) return;
    picking.current = true;
    setError(null);
    try {
      const picked = await pickPhoto(source, { maxBytes: MAX_PHOTO_BYTES });
      if (!picked.ok) {
        if (picked.reason === "cancelled") return;
        setError(
          picked.reason === "denied"
            ? source === "camera"
              ? t.issueCameraDenied
              : t.issuePhotoDenied
            : picked.reason === "too_large"
              ? (errorLabels.too_large ?? "")
              : t.issuePhotoFailed,
        );
        return;
      }
      setPhoto(picked.photo);
    } finally {
      picking.current = false;
    }
  }

  async function send(): Promise<void> {
    if (!target || busy) return;
    const body = draft.trim();
    if (!body) {
      setError(errorLabels.invalid ?? "");
      return;
    }
    setBusy(true);
    setError(null);
    if (target.mode === "guest") {
      const res = await postIssueMessage(target.orderId, target.token, body, photo);
      setBusy(false);
      if (!res.ok) {
        setError(errorLabels[res.error] ?? errorLabels.invalid ?? "");
        // The window closed or the restaurant resolved the thread while
        // this message was being typed — re-read so the sheet stops
        // offering a composer that can't work.
        if (res.error === "window_closed" || res.error === "resolved") void load();
        return;
      }
      const next = toThread(res.issue);
      setThread(next);
      setDraft("");
      setPhoto(null);
      onChanged?.(next.status);
      return;
    }
    const res = await replyStaffIssue(target.token, target.issueId, body);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "unauthorized") {
        clearStaff();
        onClose();
        return;
      }
      setError(res.error === "invalid" ? (errorLabels.invalid ?? "") : t.staffLoadFailed);
      return;
    }
    const next = staffToThread(res.data);
    setThread(next);
    setDraft("");
    onChanged?.(next.status);
  }

  function confirmResolve(): void {
    if (!target || target.mode !== "staff" || busy) return;
    // Resolving takes the guest's ability to write away, so it is asked
    // once rather than being a single unguarded tap.
    Alert.alert(t.issueResolve, t.issueResolveConfirm, [
      { text: t.issueCancel, style: "cancel" },
      {
        text: t.issueResolve,
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            const res = await resolveStaffIssue(target.token, target.issueId);
            setBusy(false);
            if (!res.ok) {
              if (res.error === "unauthorized") {
                clearStaff();
                onClose();
                return;
              }
              setError(t.staffLoadFailed);
              return;
            }
            const next = staffToThread(res.data);
            setThread(next);
            onChanged?.(next.status);
          })();
        },
      },
    ]);
  }

  const timeOf = (iso: string): string => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return "";
    return `${d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit" })} · ${d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" })}`;
  };

  const title =
    target?.mode === "staff" ? t.issueStaffTitle : thread ? t.issueTitleThread : t.issueTitle;

  return (
    <Modal visible={target !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={() => {}}
          >
            <View style={styles.header}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{title}</Text>
                {thread?.order ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {t.orderNo} #{String(thread.order.number).padStart(4, "0")}
                    {thread.order.name ? ` · ${thread.order.name}` : ""}
                  </Text>
                ) : null}
              </View>
              {thread ? (
                <View style={[styles.statusPill, resolved ? styles.pillDone : styles.pillActive]}>
                  <Text
                    style={[
                      styles.statusText,
                      resolved ? styles.pillTextDone : styles.pillTextActive,
                    ]}
                  >
                    {statusLabels[thread.status] ?? thread.status}
                  </Text>
                </View>
              ) : null}
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t.close}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            {!loaded ? (
              <ActivityIndicator color={colors.red} style={{ marginVertical: 30 }} />
            ) : failed ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateText}>{t.issueLoadFailed}</Text>
                <Pressable
                  onPress={() => {
                    setLoaded(false);
                    void load();
                  }}
                  style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryText}>{t.issueRetry}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <ScrollView
                  style={styles.threadScroll}
                  contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
                >
                  {!thread ? (
                    <Text style={styles.intro}>
                      {windowClosed ? t.issueWindowClosed : t.issueIntro}
                    </Text>
                  ) : (
                    thread.messages.map((message) => {
                      // "Mine" is the guest's own message for a guest, and
                      // the restaurant's own for the counter: each side
                      // reads its own words on its own edge.
                      const mine =
                        target?.mode === "staff"
                          ? message.author === "restaurant"
                          : message.author === "guest";
                      const who =
                        message.author === "guest"
                          ? target?.mode === "staff"
                            ? t.issueGuest
                            : t.issueYou
                          : target?.mode === "staff"
                            ? t.issueYou
                            : t.issueRestaurantLabel;
                      return (
                        <View
                          key={message.id}
                          style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
                        >
                          <View
                            style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                          >
                            <Text style={[styles.who, mine && styles.whoMine]}>{who}</Text>
                            {message.body ? (
                              <Text style={[styles.body, mine && styles.bodyMine]}>
                                {message.body}
                              </Text>
                            ) : null}
                            {message.photoUrl ? (
                              <Pressable
                                onPress={() => setViewer(message.photoUrl)}
                                accessibilityRole="imagebutton"
                                accessibilityLabel={t.issuePhotoOpen}
                                style={({ pressed }) => pressed && { opacity: 0.8 }}
                              >
                                <Image
                                  source={{ uri: message.photoUrl, headers: photoHeaders }}
                                  style={styles.thumb}
                                  resizeMode="cover"
                                />
                              </Pressable>
                            ) : null}
                            <Text style={[styles.time, mine && styles.timeMine]}>
                              {timeOf(message.createdAt)}
                            </Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>

                {/* Why there is no composer, when there isn't one. */}
                {windowClosed ? null : resolved && target?.mode === "guest" ? (
                  <Text style={styles.note}>{t.issueResolvedNote}</Text>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                {canWrite ? (
                  <View style={styles.composer}>
                    {photo ? (
                      <View style={styles.pendingRow}>
                        <Image source={{ uri: photo.uri }} style={styles.pendingThumb} />
                        <Pressable
                          onPress={() => setPhoto(null)}
                          accessibilityRole="button"
                          accessibilityLabel={t.issueRemovePhoto}
                          style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.removeText}>{t.issueRemovePhoto}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {/* The message is the one thing the Send button
                        actually insists on — the photo is optional. */}
                    <View style={styles.composeLabelRow}>
                      <FieldLabel
                        label={t.issueMessageLabel}
                        required
                        style={styles.composeLabel}
                      />
                      <RequiredLegend />
                    </View>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      accessibilityLabel={t.issueMessageLabel}
                      multiline
                      maxLength={BODY_MAX}
                      editable={!busy}
                      placeholder={
                        target?.mode === "staff"
                          ? t.issueStaffPlaceholder
                          : thread
                            ? t.issueReplyPlaceholder
                            : t.issuePlaceholder
                      }
                      placeholderTextColor={colors.inkSoft}
                      style={styles.input}
                    />
                    <View style={styles.composerRow}>
                      {/* One photo per message, guest side only — the
                          staff reply route takes text. */}
                      {target?.mode === "guest" ? (
                        <Pressable
                          onPress={choosePhotoSource}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={t.issueAddPhoto}
                          style={({ pressed }) => [
                            styles.photoBtn,
                            (busy || pressed) && { opacity: 0.6 },
                          ]}
                        >
                          <Text style={styles.photoBtnText} numberOfLines={1}>
                            📷 {t.issueAddPhoto}
                          </Text>
                        </Pressable>
                      ) : (
                        <View style={{ flex: 1 }} />
                      )}
                      <Pressable
                        onPress={() => void send()}
                        disabled={busy || draft.trim().length === 0}
                        accessibilityRole="button"
                        accessibilityLabel={t.issueSend}
                        style={({ pressed }) => [
                          styles.sendBtn,
                          (busy || draft.trim().length === 0) && { opacity: 0.5 },
                          pressed && { transform: [{ scale: 0.985 }] },
                        ]}
                      >
                        {busy ? (
                          <View style={styles.sendBusy}>
                            <ActivityIndicator color={colors.onRed} size="small" />
                            <Text style={styles.sendText}>{t.issueSending}</Text>
                          </View>
                        ) : (
                          <Text style={styles.sendText}>{t.issueSend}</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {target?.mode === "staff" && thread && !resolved ? (
                  <Pressable
                    onPress={confirmResolve}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t.issueResolve}
                    style={({ pressed }) => [
                      styles.resolveBtn,
                      (busy || pressed) && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.resolveText}>✓ {t.issueResolve}</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

      {/* A thumbnail is not evidence: tapping one opens the photo as big
          as the screen allows, on a dark ground. */}
      <Modal visible={viewer !== null} transparent animationType="fade">
        <Pressable
          style={styles.viewerBackdrop}
          onPress={() => setViewer(null)}
          accessibilityLabel={t.close}
        >
          {viewer ? (
            <Image
              source={{ uri: viewer, headers: photoHeaders }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    maxHeight: "92%",
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    gap: 10,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.ink, ...fonts.display, fontSize: 21 },
  subtitle: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  close: { color: colors.inkSoft, fontSize: 28, lineHeight: 30 },
  statusPill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11.5, ...fonts.bodyBold },
  pillActive: { backgroundColor: "#fdeee6", borderColor: colors.red },
  pillTextActive: { color: colors.red },
  pillDone: { backgroundColor: "#e9f3e4", borderColor: "#3f7030" },
  pillTextDone: { color: "#3f7030" },
  stateBox: { alignItems: "center", gap: 10, paddingVertical: 26 },
  stateText: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, textAlign: "center" },
  retry: {
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: { color: colors.red, ...fonts.bodyBold, fontSize: 13 },
  threadScroll: { maxHeight: 320 },
  intro: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, lineHeight: 20 },
  // No left/right anywhere: `flex-start` and `flex-end` are mirrored for
  // an RTL build by the layout engine itself.
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "86%",
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 4,
  },
  /** The reader's own words, in the brand's accent. */
  bubbleMine: {
    backgroundColor: colors.red,
    borderColor: colors.red,
    borderBottomEndRadius: 4,
  },
  /** The other side, on the ordinary card. */
  bubbleTheirs: {
    backgroundColor: colors.creamCard,
    borderColor: colors.line,
    borderBottomStartRadius: 4,
  },
  who: { color: colors.inkSoft, ...fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.4 },
  whoMine: { color: colors.goldSoft },
  body: { color: colors.ink, ...fonts.body, fontSize: 14, lineHeight: 20 },
  bodyMine: { color: colors.onRed },
  time: { color: colors.inkSoft, ...fonts.body, fontSize: 10.5 },
  timeMine: { color: colors.goldSoft, opacity: 0.9 },
  thumb: {
    width: 150,
    height: 110,
    borderRadius: radius.md,
    backgroundColor: colors.line,
    marginTop: 2,
  },
  note: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5, lineHeight: 18 },
  error: { color: colors.danger, ...fonts.bodySemi, fontSize: 12.5, lineHeight: 18 },
  composer: { gap: 8 },
  composeLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  composeLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  input: {
    minHeight: 76,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.creamCard,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    ...fonts.body,
    fontSize: 14,
    textAlignVertical: "top",
  },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pendingThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.line,
  },
  removeBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    // 44 is the smallest comfortable tap target.
    minHeight: 40,
    justifyContent: "center",
  },
  removeText: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  photoBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.pill,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  photoBtnText: { color: colors.red, ...fonts.bodyBold, fontSize: 13 },
  sendBtn: {
    backgroundColor: colors.red,
    borderRadius: radius.pill,
    minHeight: 44,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  sendBusy: { flexDirection: "row", alignItems: "center", gap: 8 },
  sendText: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 13.5 },
  resolveBtn: {
    borderWidth: 1.5,
    borderColor: "#3f7030",
    borderRadius: radius.pill,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  resolveText: { color: "#3f7030", ...fonts.bodyBold, fontSize: 13.5 },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: { width: "100%", height: "100%" },
});
