"use client";

import dynamic from "next/dynamic";

/**
 * Code-split entry for the cart drawer. MenuView renders this only when
 * ordering is actually enabled, so view-only menus (grace period,
 * previews) never download the cart chunk at all — and ordering menus
 * fetch it after hydration, off the critical path. SSR is off because
 * the drawer renders nothing until the guest adds an item anyway.
 */
export const CartDrawer = dynamic(() => import("./cart-drawer").then((m) => m.CartDrawer), {
  ssr: false,
});
