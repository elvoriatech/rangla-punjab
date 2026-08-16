import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local order history. The receipt token returned by placement is the
 * guest's whole credential — holding it on the device IS the order
 * history, with no account and nothing stored server-side about this
 * phone. Newest first, capped so the list can't grow unbounded.
 */
export interface StoredOrder {
  orderId: string;
  orderNumber: number;
  receiptToken: string;
  totalCents: number;
  currency: string;
  orderType: string;
  placedAt: string; // ISO
}

const KEY = "rangla-orders-v1";
const MAX = 50;

export async function listStoredOrders(): Promise<StoredOrder[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function rememberOrder(order: StoredOrder): Promise<void> {
  const existing = await listStoredOrders();
  const next = [order, ...existing.filter((o) => o.orderId !== order.orderId)].slice(0, MAX);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}
