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
import { useAuth } from "../auth";
import type { StaffItem, StaffItemPatch, StaffMenuCategory } from "../staff";
import { fetchStaffMenu, updateStaffItem } from "../staff";
import { BrandHeader, DishRow } from "../components";
import { DishSheet } from "../dish-sheet";
import { StaffDishRow, StaffItemSheet, staffViewOfGuestMenu } from "../staff-menu";
import { colors, fonts, isRTL } from "../theme";
import { useI18n } from "../i18n";

/**
 * Kategorien — chip rail + dish list, the mockup's category browser.
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

  const staffMode = staffToken !== null && staffCategories !== null;
  /** Signed in as the restaurant, list not back yet. The guest rows are
   *  NOT a stand-in for that moment: their "+" would drop a dish into a
   *  basket this device has no tab for. */
  const staffPending = staffToken !== null && staffCategories === null;
  const categories: { id: string; name: string }[] = staffMode
    ? (staffCategories ?? [])
    : menu.categories;
  const active = categories.find((c) => c.id === activeId) ?? null;

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
          <Chip label={t.all} active={activeId === null} onPress={() => setActiveId(null)} />
          {staffMode
            ? (staffCategories ?? []).map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  active={cat.id === activeId}
                  onPress={() => setActiveId(cat.id)}
                />
              ))
            : menu.categories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  photoUrl={cat.photoUrl}
                  icon={cat.icon}
                  active={cat.id === activeId}
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

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}>
        {staffPending ? <ActivityIndicator color={colors.red} style={{ marginTop: 28 }} /> : null}
        {staffPending
          ? null
          : staffMode
            ? (staffCategories ?? [])
                .filter((c) => active === null || c.id === active.id)
                .map((cat) => (
                  <View key={cat.id} style={{ gap: 10 }}>
                    {activeId === null ? <Text style={styles.catHeading}>{cat.name}</Text> : null}
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
            : menu.categories
                .filter((c) => active === null || c.id === active.id)
                .map((cat) => (
                  <View key={cat.id} style={{ gap: 10 }}>
                    {activeId === null ? <Text style={styles.catHeading}>{cat.name}</Text> : null}
                    {cat.items.map((item) => (
                      <DishRow key={item.id} item={item} onAdd={onAdd} onOpen={setOpenDish} />
                    ))}
                  </View>
                ))}
      </ScrollView>

      {staffMode ? (
        <StaffItemSheet item={editing} onClose={() => setEditing(null)} onSave={saveItem} />
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
  onPress,
}: {
  label: string;
  photoUrl?: string | null;
  /** Website's category emoji; shown when there is no photo. */
  icon?: string | null;
  active: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
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
