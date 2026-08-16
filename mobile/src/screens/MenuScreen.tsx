import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiMenu, ApiItem } from "../api";
import { BrandHeader, DishRow } from "../components";
import { colors, radius } from "../theme";

/** Kategorien — chip rail + dish list, the mockup's category browser. */
export function MenuScreen({
  menu,
  initialCategoryId,
  onAdd,
}: {
  menu: ApiMenu;
  initialCategoryId: string | null;
  onAdd: (item: ApiItem) => void;
}): React.ReactElement {
  const [activeId, setActiveId] = useState<string | null>(initialCategoryId);
  const active = menu.categories.find((c) => c.id === activeId) ?? null;
  const shown = active ? [active] : menu.categories;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title="Kategorien" />
      <View style={styles.chipBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          <Chip label="Alle" active={activeId === null} onPress={() => setActiveId(null)} />
          {menu.categories.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.name}
              active={cat.id === activeId}
              onPress={() => setActiveId(cat.id)}
            />
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}>
        {shown.map((cat) => (
          <View key={cat.id} style={{ gap: 10 }}>
            {activeId === null ? <Text style={styles.catHeading}>{cat.name}</Text> : null}
            {cat.items.map((item) => (
              <DishRow key={item.id} item={item} onAdd={onAdd} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: colors.red, borderColor: colors.red }]}
    >
      <Text style={[styles.chipText, active && { color: colors.onRed }]}>{label}</Text>
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
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  catHeading: { color: colors.ink, fontSize: 17, fontWeight: "800", marginTop: 8 },
});
