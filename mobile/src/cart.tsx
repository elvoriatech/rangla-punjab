import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApiItem } from "./api";

/**
 * Cart state — device-local, persisted so an interrupted order survives
 * an app restart. Prices here are display only: the server re-prices
 * every line at placement, so a stale cart can never change what an
 * order costs.
 */

export interface CartLine {
  itemId: string;
  name: string;
  priceCents: number;
  photoUrl: string;
  quantity: number;
}

interface CartApi {
  lines: CartLine[];
  totalCents: number;
  count: number;
  add: (item: ApiItem) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartApi | null>(null);
const STORE_KEY = "rangla-cart-v1";

export function CartProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as CartLine[];
        if (Array.isArray(parsed)) setLines(parsed.filter((l) => l && l.quantity > 0));
      } catch {
        /* corrupted state is not worth crashing over */
      }
    });
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(lines)).catch(() => {});
  }, [lines]);

  const api = useMemo<CartApi>(() => {
    const totalCents = lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
    const count = lines.reduce((sum, l) => sum + l.quantity, 0);
    return {
      lines,
      totalCents,
      count,
      add: (item) =>
        setLines((prev) => {
          const existing = prev.find((l) => l.itemId === item.id);
          if (existing) {
            return prev.map((l) =>
              l.itemId === item.id ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l,
            );
          }
          return [
            ...prev,
            {
              itemId: item.id,
              name: item.name,
              priceCents: item.priceCents,
              photoUrl: item.photoUrl,
              quantity: 1,
            },
          ];
        }),
      setQuantity: (itemId, quantity) =>
        setLines((prev) =>
          quantity <= 0
            ? prev.filter((l) => l.itemId !== itemId)
            : prev.map((l) =>
                l.itemId === itemId ? { ...l, quantity: Math.min(50, quantity) } : l,
              ),
        ),
      clear: () => setLines([]),
    };
  }, [lines]);

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}
