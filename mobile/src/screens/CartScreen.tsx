import React, { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ApiMenu, OrderType, PlacedOrder } from "../api";
import { placeOrder } from "../api";
import { useCart } from "../cart";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { rememberOrder } from "../orders-store";
import { BrandHeader, PrimaryButton, QtyStepper } from "../components";
import { colors, money, radius } from "../theme";

/**
 * Warenkorb + Kasse — the mockup's cart and checkout as one flow.
 * The server re-prices everything and validates required fields again;
 * this screen's checks exist for a friendly error, not for security.
 */
export function CartScreen({
  menu,
  presetType,
  onPlaced,
}: {
  menu: ApiMenu;
  presetType: OrderType | null;
  onPlaced: (order: PlacedOrder) => void;
}): React.ReactElement {
  const cart = useCart();
  const auth = useAuth();
  const { t } = useI18n();
  const allowed = useMemo(() => {
    const types: { key: OrderType; label: string; emoji: string }[] = [];
    if (menu.ordering.dineIn) types.push({ key: "dine_in", label: t.dineIn, emoji: "🍽️" });
    if (menu.ordering.takeaway) types.push({ key: "takeaway", label: t.pickup, emoji: "🛍️" });
    if (menu.ordering.delivery) types.push({ key: "delivery", label: t.delivery, emoji: "🛵" });
    return types;
  }, [menu.ordering, t]);

  const [orderType, setOrderType] = useState<OrderType>(
    presetType && allowed.some((t) => t.key === presetType)
      ? presetType
      : (allowed[0]?.key ?? "dine_in"),
  );
  const [tableNumber, setTableNumber] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restaurant-configured delivery areas: the guest PICKS a postcode and
  // the locality autofills; fee/minimum/free-over come from that row.
  const areas = menu.ordering.deliveryAreas;
  const area = areas.length > 0 ? areas.find((a) => a.zip === zip) : undefined;
  const areaFee = area
    ? (area.freeOverCents ?? 0) > 0 && cart.totalCents >= (area.freeOverCents ?? 0)
      ? 0
      : (area.feeCents ?? 0)
    : menu.ordering.deliveryFeeCents;
  const areaMin = area ? (area.minCents ?? 0) : menu.ordering.deliveryMinCents;
  const deliveryFee = orderType === "delivery" && cart.totalCents > 0 ? areaFee : 0;
  const grandTotal = cart.totalCents + deliveryFee;
  const belowMinimum =
    orderType === "delivery" && areaMin > 0 && cart.totalCents > 0 && cart.totalCents < areaMin;
  const needsContact = orderType !== "dine_in";
  const missing =
    cart.lines.length === 0 ||
    (needsContact && (!name.trim() || !phone.trim())) ||
    (orderType === "delivery" &&
      (!street.trim() || zip.trim().length < 3 || (areas.length > 0 && !area) || belowMinimum));

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await placeOrder(
      {
        slug: menu.venue.slug,
        items: cart.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        orderType,
        tableNumber: orderType === "dine_in" && tableNumber.trim() ? tableNumber.trim() : undefined,
        customerName: needsContact ? name.trim() : undefined,
        customerPhone: needsContact ? phone.trim() : undefined,
        address:
          orderType === "delivery"
            ? {
                street: street.trim(),
                zip: zip.trim(),
                city: area?.locality || undefined,
                note: note.trim() || undefined,
              }
            : undefined,
      },
      auth.token,
    );
    setBusy(false);
    if (!result.ok) {
      const messages: Record<string, string> = {
        ordering_paused: t.orderingPaused,
        outside_delivery_area: t.outsideArea,
        below_delivery_minimum: t.belowMin,
        unknown_items: t.menuChanged,
      };
      setError(messages[result.error] ?? t.orderFailed);
      return;
    }
    await rememberOrder({
      orderId: result.order.orderId,
      orderNumber: result.order.orderNumber,
      receiptToken: result.order.receiptToken,
      totalCents: result.order.totalCents,
      currency: menu.venue.currency,
      orderType,
      placedAt: new Date().toISOString(),
    });
    cart.clear();
    onPlaced(result.order);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.cartTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
          {cart.lines.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ fontSize: 40 }}>🛒</Text>
              <Text style={styles.emptyTitle}>{t.cartEmpty}</Text>
              <Text style={styles.emptySub}>{t.cartEmptySub}</Text>
            </View>
          ) : (
            <>
              {cart.lines.map((line) => (
                <View key={line.itemId} style={styles.line}>
                  <Image source={{ uri: line.photoUrl }} style={styles.linePhoto} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={styles.linePrice}>
                      {money(line.priceCents, menu.venue.currency)}
                    </Text>
                  </View>
                  <QtyStepper
                    quantity={line.quantity}
                    onChange={(next) => cart.setQuantity(line.itemId, next)}
                  />
                </View>
              ))}

              <View style={styles.typeRow}>
                {allowed.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => setOrderType(t.key)}
                    style={[styles.typeChip, orderType === t.key && styles.typeChipActive]}
                  >
                    <Text style={{ fontSize: 18 }}>{t.emoji}</Text>
                    <Text
                      style={[styles.typeChipText, orderType === t.key && { color: colors.red }]}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {orderType === "dine_in" ? (
                <Field
                  label={t.tableOptional}
                  value={tableNumber}
                  onChange={setTableNumber}
                  placeholder={t.tablePlaceholder}
                />
              ) : (
                <>
                  <Field
                    label={t.name}
                    value={name}
                    onChange={setName}
                    placeholder={t.namePlaceholder}
                  />
                  <Field
                    label={t.phone}
                    value={phone}
                    onChange={setPhone}
                    placeholder="+49 …"
                    keyboardType="phone-pad"
                  />
                </>
              )}
              {orderType === "delivery" ? (
                <>
                  <Field
                    label={t.street}
                    value={street}
                    onChange={setStreet}
                    placeholder="Bahnhofstraße 15"
                  />
                  <Field
                    label="PLZ"
                    value={zip}
                    onChange={setZip}
                    placeholder="56068"
                    keyboardType="number-pad"
                  />
                  <Field
                    label={t.noteOptional}
                    value={note}
                    onChange={setNote}
                    placeholder={t.notePlaceholder}
                  />
                </>
              ) : null}

              <View style={styles.totalBox}>
                <Row label={t.subtotal} value={money(cart.totalCents, menu.venue.currency)} />
                {orderType === "delivery" ? (
                  <Row label={t.deliveryFee} value={money(deliveryFee, menu.venue.currency)} />
                ) : null}
                <Row label={t.total} value={money(grandTotal, menu.venue.currency)} bold />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton
                label={`${t.placeOrder} · ${money(grandTotal, menu.venue.currency)}`}
                tone="red"
                onPress={() => void submit()}
                disabled={missing}
                busy={busy}
              />
              <Text style={styles.payNote}>
                {menu.ordering.onlinePayment || menu.ordering.paypal
                  ? t.payAfterOrder
                  : t.payAtRestaurant}
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "phone-pad" | "number-pad";
}): React.ReactElement {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 6, paddingVertical: 60 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  emptySub: { color: colors.inkSoft, fontSize: 13 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 10,
  },
  linePhoto: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.line },
  lineName: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  linePrice: { color: colors.red, fontWeight: "700", fontSize: 13, marginTop: 2 },
  typeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  typeChip: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 10,
    backgroundColor: colors.creamCard,
  },
  typeChipActive: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  typeChipText: { color: colors.inkSoft, fontSize: 12, fontWeight: "700" },
  fieldLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: "600" },
  input: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 15,
  },
  totalBox: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
    marginTop: 6,
  },
  rowLabel: { color: colors.inkSoft, fontSize: 14 },
  rowValue: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  rowBold: { fontWeight: "800", fontSize: 16, color: colors.ink },
  zipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  zipChip: {
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.creamCard,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    minWidth: 86,
  },
  zipChipActive: { backgroundColor: colors.red, borderColor: colors.red },
  zipChipZip: { color: colors.ink, fontWeight: "800", fontSize: 13 },
  zipChipCity: { color: colors.inkSoft, fontSize: 10, maxWidth: 90 },
  zipInfo: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  minWarn: { color: colors.danger, fontSize: 12, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  payNote: { color: colors.inkSoft, fontSize: 12, textAlign: "center", marginTop: 4 },
});
