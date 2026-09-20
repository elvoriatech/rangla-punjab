import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import type { ApiMenu, ApiItem } from "../api";
import { OFFERS_CATEGORY_ID, offerItems } from "../api";
import { useAuth } from "../auth";
import type { StaffItem, StaffItemPatch, StaffMenuCategory } from "../staff";
import {
  fetchStaffMenu,
  removeStaffItemPhoto,
  updateStaffItem,
  uploadStaffItemPhoto,
} from "../staff";
import { BrandHeader, DishRow, PulsingBorder } from "../components";
import { useLayout } from "../layout";
import { DishSheet } from "../dish-sheet";
import type { PhotoOutcome } from "../staff-menu";
import { StaffDishRow, StaffItemSheet, staffViewOfGuestMenu } from "../staff-menu";
import type { PickedPhoto } from "../photo";
import { colors, fonts, isRTL } from "../theme";
import { useI18n } from "../i18n";

/**
 * Kategorien — chip rail + dish list, the mockup's category browser.
 *
 * The rail's FIRST chip is "Angebote" whenever the venue has any live
 * offer — a destination, not a filter the guest has to assemble: the
 * dishes keep their real category (so the basket is unaffected), they
 * are simply gathered under one tab the way the website gathers them
 * under one section (P7-12). With no live offer there is no chip.
 *
 * In RESTAURANT MODE the same screen becomes the menu's editor: the rows
 * come from `/staff/menu` (the owner's working copy, offers and all) and
 * each one carries a pencil and an availability switch instead of the
 * guest's "+". Nothing else moves — the owner is looking at their menu in
 * the shape their guests see it, which is the point.
 */
export function MenuScreen({
  menu,
  initialCategoryId,
  onAdd,
  onOpenOwnerMenu,
  onMenuChanged,
}: {
  menu: ApiMenu;
  initialCategoryId: string | null;
  onAdd: (item: ApiItem) => void;
  /** Restaurant mode only: opens the burger's sheet. */
  onOpenOwnerMenu?: () => void;
  /** An edit landed — the guest menu the rest of the app renders is now
   *  stale, so the shell refetches it. */
  onMenuChanged?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const [activeId, setActiveId] = useState<string | null>(initialCategoryId);
  const [openDish, setOpenDish] = useState<ApiItem | null>(null);

  const [staffCategories, setStaffCategories] = useState<StaffMenuCategory[] | null>(null);
  const [editing, setEditing] = useState<StaffItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The guest menu is the fallback list, but it must not re-trigger the
  // staff read every time an edit refreshes it — hence a ref, not a dep.
  const guestCategories = useRef(menu.categories);
  guestCategories.current = menu.categories;

  useEffect(() => {
    if (!staffToken) {
      setStaffCategories(null);
      return;
    }
    let alive = true;
    void fetchStaffMenu(staffToken).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setStaffCategories(res.data);
        return;
      }
      if (res.error === "unauthorized") clearStaff();
      // Never blank: show the published menu and let the controls fail
      // honestly rather than leaving the owner with an empty screen.
      setStaffCategories(staffViewOfGuestMenu(guestCategories.current));
    });
    return () => {
      alive = false;
    };
  }, [staffToken, clearStaff, reloadKey]);

  const applyItem = useCallback((next: StaffItem) => {
    setStaffCategories((current) =>
      current
        ? current.map((c) => ({
            ...c,
            items: c.items.map((i) => (i.id === next.id ? next : i)),
          }))
        : current,
    );
  }, []);

  const toggleAvailable = useCallback(
    async (item: StaffItem, next: boolean): Promise<void> => {
      if (!staffToken || busyId) return;
      setBusyId(item.id);
      setNote(null);
      // Optimistic: a switch that waits for a round trip feels broken.
      applyItem({ ...item, isAvailable: next });
      const res = await updateStaffItem(staffToken, item.id, { isAvailable: next });
      setBusyId(null);
      if (!res.ok) {
        applyItem(item);
        if (res.error === "unauthorized") clearStaff();
        else setNote(res.error === "notfound" ? t.staffItemGone : t.staffToggleFailed);
        return;
      }
      if (res.data) applyItem(res.data);
      // The change is already live for guests — pull the menu the rest of
      // the app renders back in line with it.
      onMenuChanged?.();
    },
    [staffToken, busyId, applyItem, clearStaff, onMenuChanged, t],
  );

  /** Resolves to null on success, else the rejected field ("" when the
   *  server named none) — the sheet turns that into an inline message. */
  const saveItem = useCallback(
    async (item: StaffItem, patch: StaffItemPatch): Promise<string | null> => {
      if (!staffToken) return "";
      setNote(null);
      const res = await updateStaffItem(staffToken, item.id, patch);
      if (!res.ok) {
        if (res.error === "unauthorized") {
          clearStaff();
          return "";
        }
        if (res.error === "notfound") {
          setNote(t.staffItemGone);
          return "";
        }
        return res.field ?? "";
      }
      // Whether an offer is ACTIVE is the server's verdict (its clock, its
      // timezone) — take the echoed item, or re-read the list for it.
      if (res.data) applyItem(res.data);
      else setReloadKey((n) => n + 1);
      onMenuChanged?.();
      return null;
    },
    [staffToken, applyItem, clearStaff, onMenuChanged, t],
  );

  /**
   * The dish photo: its own route, saved the moment it is picked rather
   * than with the rest of the form. A `null` file removes it.
   *
   * The echoed item goes straight into the list, so the row behind the
   * sheet shows the new picture before the sheet is even closed.
   */
  const savePhoto = useCallback(
    async (item: StaffItem, file: PickedPhoto | null): Promise<PhotoOutcome> => {
      if (!staffToken) return { ok: false, error: "unauthorized" };
      setNote(null);
      const res = file
        ? await uploadStaffItemPhoto(staffToken, item.id, file)
        : await removeStaffItemPhoto(staffToken, item.id);
      if (!res.ok) {
        if (res.error === "unauthorized") clearStaff();
        else if (res.error === "notfound") setNote(t.staffItemGone);
        return { ok: false, error: res.error };
      }
      if (res.data) applyItem(res.data);
      // No echo: the list can only learn the new URL by re-reading.
      else setReloadKey((n) => n + 1);
      onMenuChanged?.();
      return { ok: true, item: res.data };
    },
    [staffToken, applyItem, clearStaff, onMenuChanged, t],
  );

  const staffMode = staffToken !== null && staffCategories !== null;
  /** Signed in as the restaurant, list not back yet. The guest rows are
   *  NOT a stand-in for that moment: their "+" would drop a dish into a
   *  basket this device has no tab for. */
  const staffPending = staffToken !== null && staffCategories === null;
  const categories: { id: string; name: string }[] = staffMode
    ? (staffCategories ?? [])
    : menu.categories;
  // The offers destination is a synthetic category: same id the website
  // uses for its synthetic first section, so the two stay describable in
  // one sentence. It exists only while the venue has live offers — and a
  // stale selection (the last offer ended while the tab was open) falls
  // back to "all" rather than showing an empty screen.
  const offerCount = menu.offerCount ?? 0;
  const guestOffers = offerItems(menu);
  const staffOffers = (staffCategories ?? []).flatMap((c) => c.items.filter((i) => i.offerActive));
  const offers = staffMode ? staffOffers : guestOffers;
  const hasOffers = staffMode ? staffOffers.length > 0 : offerCount > 0;
  const offersActive = activeId === OFFERS_CATEGORY_ID && hasOffers;
  const active = offersActive ? null : (categories.find((c) => c.id === activeId) ?? null);
  /** "All" is the default; the offers tab is its own thing, so neither
   *  may look selected while the other is. */
  const allActive = activeId === null || (activeId === OFFERS_CATEGORY_ID && !hasOffers);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader
        title={staffMode || staffPending ? t.staffMenuTitle : t.categories}
        onMenu={onOpenOwnerMenu}
      />
      <View style={styles.chipBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 14, paddingHorizontal: 16 }}
        >
          {/* First in the rail, ahead of "All" — an offer is the reason
              a guest opens the menu at all, and it stops existing the
              moment the venue's last offer ends. */}
          {hasOffers ? (
            <Chip
              label={t.offersTab}
              icon="🔥"
              pulse
              active={offersActive}
              onPress={() => setActiveId(OFFERS_CATEGORY_ID)}
            />
          ) : null}
          <Chip label={t.all} active={allActive} onPress={() => setActiveId(null)} />
          {staffMode
            ? (staffCategories ?? []).map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  active={!offersActive && cat.id === activeId}
                  onPress={() => setActiveId(cat.id)}
                />
              ))
            : menu.categories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  photoUrl={cat.photoUrl}
                  icon={cat.icon}
                  active={!offersActive && cat.id === activeId}
                  onPress={() => setActiveId(cat.id)}
                />
              ))}
        </ScrollView>
      </View>

      {staffMode ? (
        <>
          <Text style={styles.liveHint}>{t.staffMenuLive}</Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </>
      ) : null}

      {/* In restaurant mode this is a settings list — one editable dish
          per row — so it is capped and centred like the other owner
          screens. The guest menu keeps the full width: its rows carry
          photography, and a 720 pt gutter on a tablet would waste it. */}
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 32,
          gap: 10,
          ...(staffMode || staffPending ? layout.content : null),
        }}
      >
        {staffPending ? <ActivityIndicator color={colors.red} style={{ marginTop: 28 }} /> : null}
        {staffPending ? null : offersActive ? (
          // One flat list: offers cut ACROSS categories, so grouping them
          // by the category they happen to live in would undo the point.
          offers.length === 0 ? (
            <Text style={styles.liveHint}>{t.offersEmpty}</Text>
          ) : staffMode ? (
            (offers as StaffItem[]).map((item) => (
              <StaffDishRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onEdit={setEditing}
                onToggle={(target, next) => void toggleAvailable(target, next)}
              />
            ))
          ) : (
            (offers as ApiItem[]).map((item) => (
              <DishRow key={item.id} item={item} onAdd={onAdd} onOpen={setOpenDish} />
            ))
          )
        ) : staffMode ? (
          (staffCategories ?? [])
            .filter((c) => active === null || c.id === active.id)
            .map((cat) => (
              <View key={cat.id} style={{ gap: 10 }}>
                {allActive ? <Text style={styles.catHeading}>{cat.name}</Text> : null}
                {cat.items.map((item) => (
                  <StaffDishRow
                    key={item.id}
                    item={item}
                    busy={busyId === item.id}
                    onEdit={setEditing}
                    onToggle={(target, next) => void toggleAvailable(target, next)}
                  />
                ))}
              </View>
            ))
        ) : (
          menu.categories
            .filter((c) => active === null || c.id === active.id)
            .map((cat) => (
              <View key={cat.id} style={{ gap: 10 }}>
                {allActive ? <Text style={styles.catHeading}>{cat.name}</Text> : null}
                {cat.items.map((item) => (
                  <DishRow key={item.id} item={item} onAdd={onAdd} onOpen={setOpenDish} />
                ))}
              </View>
            ))
        )}
      </ScrollView>

      {staffMode ? (
        <StaffItemSheet
          item={editing}
          onClose={() => setEditing(null)}
          onSave={saveItem}
          onPhoto={savePhoto}
        />
      ) : (
        <DishSheet item={openDish} onClose={() => setOpenDish(null)} onAdd={onAdd} />
      )}
    </View>
  );
}

function Chip({
  label,
  photoUrl,
  icon,
  active,
  pulse = false,
  onPress,
}: {
  label: string;
  photoUrl?: string | null;
  /** Website's category emoji; shown when there is no photo. */
  icon?: string | null;
  active: boolean;
  /** Offers only: the same breathing ring the Home card wears, so a guest
   *  who came from that card recognises where they landed. */
  pulse?: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      {/* The ring hugs the chip's own bounds rather than reaching outside
          them: the rail's chips are laid out on a fixed gap, and a ring
          that grew the offers chip by 2 pt a side would push every
          category along it. Selected, it has to lose the same corner the
          red bubble does, or it would round off the point the tail grows
          out of. */}
      {pulse ? <PulsingBorder style={active ? styles.chipRingActive : styles.chipRing} /> : null}
      {/* Owner-uploaded category photo, when there is one — tiny round
          thumb so the rail stays a text rail, just richer. */}
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.chipPhoto} />
      ) : icon ? (
        <Text style={styles.chipIcon}>{icon}</Text>
      ) : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {active ? (
        // The mockup bubble's tail: hangs off the bottom-right, its top
        // edge curving INWARD (concave) out to a long sharp point.
        <Svg
          width={16}
          height={15}
          viewBox="0 0 16 15"
          style={[styles.chipTail, isRTL && { transform: [{ scaleX: -1 }] }]}
        >
          <Path d="M0 0 C3 9 9 13.4 16 15 L0 15 Z" fill={colors.red} />
        </Svg>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipBar: {
    backgroundColor: colors.creamCard,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
  },
  // Mockup's category rail: the active category is a red speech-bubble
  // tab whose bottom-RIGHT corner sweeps to a sharp point; the rest are
  // plain text, no box.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
  },
  chipPhoto: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.line },
  chipIcon: { fontSize: 16, marginEnd: 6 },
  chipActive: {
    backgroundColor: colors.red,
    borderRadius: 18,
    // Logical corner: the tail hangs off the END of the row, so the
    // squared-off corner has to follow the reading direction too.
    borderEndEndRadius: 0,
  },
  chipTail: { position: "absolute", end: -15, bottom: 0 },
  chipRing: { borderRadius: 18 },
  chipRingActive: { borderRadius: 18, borderEndEndRadius: 0 },
  chipText: { color: colors.ink, fontSize: 13.5, ...fonts.bodySemi },
  chipTextActive: { color: colors.onRed, ...fonts.bodyBold },
  catHeading: { color: colors.ink, fontSize: 17, ...fonts.bodyHeavy, marginTop: 8 },
  liveHint: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  note: {
    color: colors.danger,
    ...fonts.bodySemi,
    fontSize: 12.5,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
});
