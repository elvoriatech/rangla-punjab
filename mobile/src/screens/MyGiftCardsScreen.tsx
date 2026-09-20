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
import type { GiftCardView } from "../gift-cards";
import { fetchMyGiftCards } from "../gift-cards";
import { GiftCardCard, GiftCardRow } from "../gift-card-card";
import { BrandHeader } from "../components";
import { useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts } from "../theme";

/**
 * "My gift cards" — every card this account has BOUGHT, in whatever
 * state, newest first.
 *
 * Bought, not held: a gift card is a bearer instrument with no owner
 * field, so there is no honest way to list "the cards in your
 * possession". What the account can show is the ones you paid for —
 * including the ones you gave away, which is exactly the list the buyer
 * wants ("did they use it yet?"). The timeline on each card answers
 * that.
 */
export function MyGiftCardsScreen({
  venueName,
  onBack,
}: {
  venueName: string;
  onBack: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { token } = useAuth();
  const layout = useLayout();
  const [cards, setCards] = useState<GiftCardView[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** The card the guest tapped open. Not a tab: it is the same list with
   *  one row expanded into the whole card, and Back closes it. */
  const [open, setOpen] = useState<GiftCardView | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const next = await fetchMyGiftCards(token);
    setCards(next);
    // A card opened before a refresh keeps its place, with whatever the
    // server now says about it — the status may well be why the guest
    // pulled to refresh.
    setOpen((current) => (current ? (next.find((c) => c.id === current.id) ?? current) : null));
  }, [token]);

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
      <BrandHeader title={t.giftCardsMine} onBack={open ? () => setOpen(null) : onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 40,
          gap: 12,
          ...layout.content,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.red}
          />
        }
      >
        {open ? (
          <GiftCardCard card={open} venueName={venueName} />
        ) : cards === null ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : cards.length === 0 ? (
          <Text style={styles.empty}>{t.giftCardsMineEmpty}</Text>
        ) : (
          cards.map((card) => (
            <Pressable
              key={card.id}
              onPress={() => setOpen(card)}
              accessibilityRole="button"
              accessibilityLabel={`${card.codeFormatted.split("-").join(" ")}`}
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
            >
              <GiftCardRow card={card} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, marginTop: 24 },
});
