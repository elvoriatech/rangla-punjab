import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asUser } from "./tenant";
import { getActiveVenueId } from "./active-venue";
import { MENU_THEMES, MENU_TEXTURES, MENU_BACKDROPS } from "./menu-themes";
import { LOCALES } from "./locales";

/**
 * Venue reads + writes for the owner dashboard. Same shape as the other
 * services: session user in, RLS-scoped transaction inside, enum-shaped
 * errors out. MVP model is one venue per tenant, so `findFirst` is the
 * lookup — revisit when multi-venue lands.
 */

export interface DashboardVenue {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  defaultLocale: string;
  enabledLocales: string[];
  currency: string;
  branding: {
    primaryColor?: string;
    logoKey?: string | null;
    bannerKey?: string | null;
    theme?: string;
    texture?: string;
    backdrop?: string;
    headingColor?: string;
    categoryIcons?: string;
    navLayout?: string;
    cardBorders?: string;
    halalFilter?: string;
    kiosk?: string;
  };
}

type ServiceResult<T = undefined> =
  { ok: true; value: T } | { ok: false; error: "no_venue" | "invalid" };

function normalizeBranding(raw: unknown): DashboardVenue["branding"] {
  if (raw && typeof raw === "object") {
    const b = raw as Record<string, unknown>;
    return {
      primaryColor: typeof b.primaryColor === "string" ? b.primaryColor : undefined,
      logoKey: typeof b.logoKey === "string" ? b.logoKey : null,
      bannerKey: typeof b.bannerKey === "string" ? b.bannerKey : null,
      theme: typeof b.theme === "string" ? b.theme : undefined,
      texture: typeof b.texture === "string" ? b.texture : undefined,
      backdrop: typeof b.backdrop === "string" ? b.backdrop : undefined,
      headingColor: typeof b.headingColor === "string" ? b.headingColor : undefined,
      categoryIcons: typeof b.categoryIcons === "string" ? b.categoryIcons : undefined,
      navLayout: typeof b.navLayout === "string" ? b.navLayout : undefined,
      cardBorders: typeof b.cardBorders === "string" ? b.cardBorders : undefined,
      halalFilter: typeof b.halalFilter === "string" ? b.halalFilter : undefined,
      kiosk: typeof b.kiosk === "string" ? b.kiosk : undefined,
    };
  }
  return {};
}

/** Dashboard base path (`/dashboard`) when the session user has a venue,
 *  or null before onboarding creates one. Actions use it for redirects.
 *  Single-restaurant deploy: the path is constant (no slug segment). */
export async function venueAdminBase(userId: string): Promise<string | null> {
  const venue = await getVenueForUser(userId);
  return venue.ok ? "/dashboard" : null;
}

export async function getVenueForUser(userId: string): Promise<ServiceResult<DashboardVenue>> {
  const activeId = await getActiveVenueId(userId);
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      // Scope to the owner's active branch when one is selected; otherwise
      // the oldest venue (getActiveVenueId's default).
      where: { deletedAt: null, ...(activeId ? { id: activeId } : {}) },
      select: {
        id: true,
        tenantId: true,
        name: true,
        slug: true,
        defaultLocale: true,
        enabledLocales: true,
        currency: true,
        branding: true,
      },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return {
      ok: true as const,
      value: { ...venue, branding: normalizeBranding(venue.branding) },
    };
  });
}

export const appearanceSchema = z.object({
  theme: z.enum(MENU_THEMES.map((t) => t.id) as [string, ...string[]]),
  texture: z.enum(MENU_TEXTURES.map((t) => t.id) as [string, ...string[]]),
  // Full-page background artwork; "none" = plain theme color.
  backdrop: z.enum(MENU_BACKDROPS.map((b) => b.id) as [string, ...string[]]).default("none"),
  // Custom category-heading color (hex); absent = each layout's default.
  headingColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  // "names" (default): category names only. "icons": an icon rides along —
  // the category's uploaded photo when present, an inferred emoji otherwise.
  categoryIcons: z.enum(["names", "icons"]).default("names"),
  // Where the category navigation lives on LARGE screens: the sticky
  // top bar (default) or a left side rail. Phones always keep the top
  // bar — a rail has no room there.
  navLayout: z.enum(["top", "side"]).default("top"),
  // Dish-card outlines: "off" hides the hairline border (cards separate
  // by shadow instead) — some themes read cleaner without the frame.
  cardBorders: z.enum(["on", "off"]).default("on"),
  // Self-order kiosk scaling for very large PORTRAIT touchscreens
  // (≥1000px wide AND ≥1200px tall — nothing a guest's phone or laptop
  // ever reports, so the same URL stays untouched everywhere else).
  // "lg"/"xl" raise the root font size there so the whole rem-based UI
  // grows together and fills the width.
  kiosk: z.enum(["off", "lg", "xl"]).default("lg"),
});

/**
 * Save the public menu's theme + texture. Merges into the branding JSON so
 * primaryColor/logoKey survive untouched.
 */
export async function updateVenueAppearance(
  userId: string,
  input: {
    theme: string;
    texture: string;
    backdrop?: string;
    headingColor?: string;
    categoryIcons?: string;
    navLayout?: string;
    cardBorders?: string;
    kiosk?: string;
  },
): Promise<ServiceResult> {
  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, branding: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };

    const branding = {
      ...normalizeBranding(venue.branding),
      theme: parsed.data.theme,
      texture: parsed.data.texture,
      backdrop: parsed.data.backdrop,
      headingColor: parsed.data.headingColor,
      categoryIcons: parsed.data.categoryIcons,
      navLayout: parsed.data.navLayout,
      cardBorders: parsed.data.cardBorders,
      kiosk: parsed.data.kiosk,
    };
    await tx.venue.update({ where: { id: venue.id }, data: { branding } });
    return { ok: true as const, value: undefined };
  });
}

export const venueNameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

/**
 * Languages a venue can enable for its public menu — the `{code,label}`
 * projection of the ONE registry in `src/lib/locales.ts`. Adding a
 * language there makes it selectable in settings and routable at
 * /{locale}; dish-level translations fall back to the default-locale
 * text until they're entered. Order is the registry's, and
 * `updateVenueLocalization` normalises `enabledLocales` to it.
 */
export const SUPPORTED_LOCALES: readonly { code: string; label: string }[] = LOCALES.map((l) => ({
  code: l.code,
  label: l.label,
}));

/** EU-market currencies. `Intl.NumberFormat` handles the symbols. */
export const SUPPORTED_CURRENCIES = [
  "EUR",
  "CHF",
  "GBP",
  "USD",
  "DKK",
  "SEK",
  "NOK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
] as const;

const localeCodes = SUPPORTED_LOCALES.map((l) => l.code) as [string, ...string[]];

export const localizationSchema = z
  .object({
    currency: z.enum(SUPPORTED_CURRENCIES),
    defaultLocale: z.enum(localeCodes),
    enabledLocales: z.array(z.enum(localeCodes)).min(1).max(SUPPORTED_LOCALES.length),
  })
  .refine((v) => v.enabledLocales.includes(v.defaultLocale), {
    message: "defaultLocale must be one of enabledLocales",
  });

/**
 * Save currency + languages. The currency also cascades to every item in
 * the current draft so the menu never mixes currencies — guests see the
 * change after the next publish.
 */
export async function updateVenueLocalization(
  userId: string,
  input: { currency: string; defaultLocale: string; enabledLocales: string[] },
): Promise<ServiceResult> {
  const parsed = localizationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };

    await tx.venue.update({
      where: { id: venue.id },
      data: {
        currency: parsed.data.currency,
        defaultLocale: parsed.data.defaultLocale,
        // De-dup while preserving the supported-list order for a stable UI.
        enabledLocales: SUPPORTED_LOCALES.map((l) => l.code).filter((c) =>
          parsed.data.enabledLocales.includes(c),
        ),
      },
    });
    await tx.item.updateMany({
      where: { category: { menuVersion: { status: "draft" } } },
      data: { currency: parsed.data.currency },
    });
    return { ok: true as const, value: undefined };
  });
}

/**
 * Set (or clear) the venue logo. `logoKey` is the S3 storage key of an
 * already-ingested Media row; rendering goes through /img like every
 * other upload.
 */
export async function updateVenueLogo(
  userId: string,
  logoKey: string | null,
): Promise<ServiceResult> {
  if (logoKey !== null && (logoKey.length === 0 || logoKey.length > 512)) {
    return { ok: false, error: "invalid" };
  }
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, branding: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const branding = { ...normalizeBranding(venue.branding), logoKey };
    await tx.venue.update({ where: { id: venue.id }, data: { branding } });
    return { ok: true as const, value: undefined };
  });
}

/**
 * Set (or clear) the venue's top banner — the wide hero image guests
 * see under the sticky bar. Same contract as updateVenueLogo.
 */
export async function updateVenueBanner(
  userId: string,
  bannerKey: string | null,
): Promise<ServiceResult> {
  if (bannerKey !== null && (bannerKey.length === 0 || bannerKey.length > 512)) {
    return { ok: false, error: "invalid" };
  }
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, branding: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const branding = { ...normalizeBranding(venue.branding), bannerKey };
    await tx.venue.update({ where: { id: venue.id }, data: { branding } });
    return { ok: true as const, value: undefined };
  });
}

/**
 * Toggle the optional Halal filter + badge. Vegetarian/vegan/gluten-free/
 * dairy-free are universal; whether to advertise halal is the
 * restaurant's own call, so it's opt-in per venue.
 */
export async function updateVenueHalalFilter(
  userId: string,
  enabled: boolean,
): Promise<ServiceResult> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, branding: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const branding = { ...normalizeBranding(venue.branding), halalFilter: enabled ? "on" : "off" };
    await tx.venue.update({ where: { id: venue.id }, data: { branding } });
    return { ok: true as const, value: undefined };
  });
}

export async function updateVenueName(
  userId: string,
  input: { name: string },
): Promise<ServiceResult> {
  const parsed = venueNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({ where: { id: venue.id }, data: { name: parsed.data.name } });
    return { ok: true as const, value: undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Google rating (P7-14)                                               */
/* ------------------------------------------------------------------ */

import { parseCachedRating, reviewUrl, type CachedRating } from "./google-rating";

export interface VenueGoogleSettings {
  /** The owner's Place ID, or null when they have not set one. */
  placeId: string | null;
  /** Last rating read from Google — null until the first refresh runs
   *  (which needs the ⛔ human-gated API key). */
  rating: CachedRating | null;
  /** Where the guest-facing "Write a review" link points. Null without a
   *  Place ID; shown in Settings so the owner can check it themselves. */
  reviewUrl: string | null;
}

/**
 * Google Place IDs are opaque, base64url-ish and documented as up to 255
 * characters. We validate the SHAPE only — whether the id names this
 * restaurant is between the owner and Google, and the first refresh
 * answering nothing is what a wrong id looks like.
 */
export const GOOGLE_PLACE_ID_RE = /^[A-Za-z0-9_-]{6,255}$/;

/** The Google card's state for the settings page. */
export async function getVenueGoogle(userId: string): Promise<ServiceResult<VenueGoogleSettings>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { googlePlaceId: true, googleRating: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return {
      ok: true as const,
      value: {
        placeId: venue.googlePlaceId,
        rating: parseCachedRating(venue.googleRating),
        reviewUrl: venue.googlePlaceId ? reviewUrl(venue.googlePlaceId) : null,
      },
    };
  });
}

/**
 * Save (or clear) the venue's Google Place ID. An empty string clears it,
 * which is how the owner turns the rating line off.
 *
 * Changing the id also drops the cached rating: that number belongs to the
 * PREVIOUS place, and showing it under a new Place ID — even for the few
 * hours until the next refresh — would be a wrong number on the menu.
 */
export async function updateVenueGooglePlaceId(
  userId: string,
  rawPlaceId: string,
): Promise<ServiceResult> {
  const trimmed = rawPlaceId.trim();
  if (trimmed.length > 0 && !GOOGLE_PLACE_ID_RE.test(trimmed)) {
    return { ok: false, error: "invalid" };
  }
  const placeId = trimmed.length > 0 ? trimmed : null;

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, googlePlaceId: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({
      where: { id: venue.id },
      data: {
        googlePlaceId: placeId,
        // `Prisma.DbNull` is SQL NULL in a nullable JSONB column — a bare
        // `null` there would be the JSON value `null`, which is not the
        // same thing and would not read back as "no rating".
        ...(placeId === venue.googlePlaceId ? {} : { googleRating: Prisma.DbNull }),
      },
    });
    return { ok: true as const, value: undefined };
  });
}

/**
 * Draft-menu counts for the overview stat tiles. Zero draft (fresh tenant
 * mid-onboarding) reports zeros rather than erroring — the overview stays
 * renderable at every lifecycle stage.
 */
export async function getMenuCounts(
  userId: string,
): Promise<{ categories: number; items: number }> {
  return asUser(userId, async (tx) => {
    const draft = await tx.menuVersion.findFirst({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!draft) return { categories: 0, items: 0 };
    const [categories, items] = await Promise.all([
      tx.category.count({ where: { menuVersionId: draft.id } }),
      tx.item.count({
        where: { category: { menuVersionId: draft.id }, deletedAt: null },
      }),
    ]);
    return { categories, items };
  });
}

/* ------------------------------------------------------------------ */
/* Ordering settings (P4)                                              */
/* ------------------------------------------------------------------ */

import { resolveTenantAccess, type TenantAccess } from "./plan-state";
import { orderingConfigSchema, parseOrderingConfig, type OrderingConfig } from "./ordering-config";

export interface OrderingSettings {
  access: TenantAccess;
  config: OrderingConfig;
}

/** Ordering config + the derived plan/trial state, for the dashboard. */
export async function getOrderingSettings(
  userId: string,
): Promise<ServiceResult<OrderingSettings>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { ordering: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const [tenant] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          plan: true,
          entitlementOverrides: true,
          createdAt: true,
          status: true,
          deletedAt: true,
        },
      }),
    ]);
    return {
      ok: true as const,
      value: {
        access: resolveTenantAccess(tenant),
        config: parseOrderingConfig(venue.ordering),
      },
    };
  });
}

/** Save the owner's ordering switches + delivery zone/fee settings. */
export async function updateVenueOrdering(userId: string, input: unknown): Promise<ServiceResult> {
  const parsed = orderingConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({ where: { id: venue.id }, data: { ordering: parsed.data } });
    return { ok: true as const, value: undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Loyalty settings                                                    */
/* ------------------------------------------------------------------ */

import { loyaltyConfigSchema, parseLoyaltyConfig, type LoyaltyConfig } from "./loyalty-config";

/** The owner's loyalty switches, for the Settings page. */
export async function getLoyaltySettings(userId: string): Promise<ServiceResult<LoyaltyConfig>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { loyalty: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return { ok: true as const, value: parseLoyaltyConfig(venue.loyalty) };
  });
}

/** Save the owner's loyalty switches. Same shape as the ordering save:
 *  the schema is the validator, so a garbage field never lands in JSONB. */
export async function updateVenueLoyalty(userId: string, input: unknown): Promise<ServiceResult> {
  const parsed = loyaltyConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({ where: { id: venue.id }, data: { loyalty: parsed.data } });
    return { ok: true as const, value: undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Opening hours (P8)                                                  */
/* ------------------------------------------------------------------ */

import type { OpeningHours } from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";

export interface VenueHours {
  timezone: string;
  hours: OpeningHours;
}

/** Opening hours + timezone for the settings page. */
export async function getVenueHours(userId: string): Promise<ServiceResult<VenueHours>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { timezone: true, hours: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return {
      ok: true as const,
      value: { timezone: venue.timezone, hours: parseOpeningHours(venue.hours) },
    };
  });
}

/** Save canonical opening hours (already compiled by the action). */
export async function updateVenueHours(
  userId: string,
  hours: OpeningHours,
): Promise<ServiceResult> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({ where: { id: venue.id }, data: { hours } });
    return { ok: true as const, value: undefined };
  });
}
