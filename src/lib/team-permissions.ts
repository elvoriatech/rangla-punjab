/**
 * The dashboard areas a team member can be given (owner, 2026-09-30),
 * with the owner-facing wording and the two presets. Pure data, so the
 * Team page's checkbox component can import it in the browser; the
 * server-side checks live in `team-access.ts`.
 */

export const PERMISSIONS = [
  "overview",
  "orders",
  "cancel",
  "reservations",
  "catering",
  "kitchen",
  "qr",
  "menu",
  "giftcards",
  "appearance",
  "reports",
  "settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The owner-facing wording for each box on the Team page. */
export const PERMISSION_LABELS: Record<Permission, { label: string; hint: string }> = {
  overview: { label: "Overview", hint: "Today's numbers on the start page" },
  orders: {
    label: "Orders & complaints",
    hint: "See orders, change status, answer complaints, print",
  },
  cancel: {
    label: "Cancel orders",
    hint: "Cancel an order (web and app) — it cannot be undone",
  },
  reservations: { label: "Reservations", hint: "Confirm or decline table requests" },
  catering: { label: "Catering", hint: "See and answer catering requests" },
  kitchen: { label: "Kitchen screen", hint: "The live kitchen board" },
  qr: { label: "QR codes", hint: "View and download table / app QR codes" },
  menu: { label: "Edit the menu", hint: "Edit dishes, prices, offers and publish the menu" },
  giftcards: { label: "Gift cards", hint: "Sold gift cards and redemptions" },
  appearance: { label: "Appearance", hint: "Menu theme and look" },
  reports: { label: "Reports", hint: "Sales and order reports" },
  settings: {
    label: "Settings",
    hint: "Opening hours, ordering, delivery, slider, loyalty, contact",
  },
};

/** Starting points on the Team page; the owner can tick or untick any box. */
export const PRESETS: Record<"manager" | "staff", readonly Permission[]> = {
  manager: [
    "overview",
    "orders",
    "cancel",
    "reservations",
    "catering",
    "kitchen",
    "qr",
    "menu",
    "giftcards",
    "appearance",
    "reports",
  ],
  staff: ["overview", "orders", "reservations", "kitchen", "qr"],
};

/** Narrow whatever is stored to known names, deduplicated, in list order. */
export function normalizePermissions(raw: readonly string[]): Permission[] {
  const set = new Set(raw);
  return PERMISSIONS.filter((p) => set.has(p));
}
