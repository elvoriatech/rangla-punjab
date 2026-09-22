import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asUser } from "./tenant";
import { getActiveVenueId } from "./active-venue";
import { MENU_THEMES, MENU_TEXTURES, MENU_BACKDROPS } from "./menu-themes";
import { LOCALES } from "./locales";
import { heroSlidesOf, MAX_HERO_SLIDES } from "./hero-slides";

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
    /** The app's home-slider images, in display order (storage keys). */
    heroSlides?: string[];
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
      heroSlides: heroSlidesOf(b.heroSlides),
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
 * The app's home slider. Every change — add, remove, reorder — is a
 * function of the CURRENT list, applied inside the same transaction that
 * reads it, so two quick clicks in the dashboard can't lose a slide.
 *
 * - `add`: appends; refused once the slider already holds the maximum.
 * - `remove`: drops that key (a key that isn't there is a no-op success).
 * - `move`: swaps the key with its neighbour, `-1` = earlier, `1` = later.
 */
export type HeroSlideChange =
  | { op: "add"; key: string }
  | { op: "remove"; key: string }
  | { op: "move"; key: string; by: -1 | 1 };

export async function updateVenueHeroSlides(
  userId: string,
  change: HeroSlideChange,
): Promise<ServiceResult | { ok: false; error: "full" }> {
  if (change.key.length === 0 || change.key.length > 512) return { ok: false, error: "invalid" };
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, branding: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const current = normalizeBranding(venue.branding);
    const slides = [...(current.heroSlides ?? [])];
    if (change.op === "add") {
      if (slides.length >= MAX_HERO_SLIDES) return { ok: false, error: "full" as const };
      slides.push(change.key);
    } else if (change.op === "remove") {
      const at = slides.indexOf(change.key);
      if (at >= 0) slides.splice(at, 1);
    } else {
      const at = slides.indexOf(change.key);
      const to = at + change.by;
      if (at < 0 || to < 0 || to >= slides.length) return { ok: true as const, value: undefined };
      [slides[at], slides[to]] = [slides[to]!, slides[at]!];
    }
    const branding = { ...current, heroSlides: slides };
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

import {
  parseCachedRating,
  parseManualRating,
  parseManualRatingInput,
  refreshVenueRatingNow,
  reviewUrl,
  type CachedRating,
  type ManualRating,
  type RatingError,
} from "./google-rating";

export interface VenueGoogleSettings {
  /** The owner's Place ID, or null when they have not set one. */
  placeId: string | null;
  /** Last rating read from Google — null until the first refresh runs
   *  (which needs the ⛔ human-gated API key). */
  rating: CachedRating | null;
  /** The owner's switch for the guest-facing line. True by default — a
   *  venue that has never touched it shows whatever rating it has. */
  enabled: boolean;
  /** The number the owner typed themselves, or null. Shown on the menu
   *  only while `rating` above is empty — the fetched value always wins,
   *  and the card says so when both exist. */
  manual: ManualRating | null;
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
      select: {
        googlePlaceId: true,
        googleRating: true,
        googleRatingManual: true,
        googleRatingEnabled: true,
      },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return {
      ok: true as const,
      value: {
        placeId: venue.googlePlaceId,
        enabled: venue.googleRatingEnabled,
        rating: parseCachedRating(venue.googleRating),
        manual: parseManualRating(venue.googleRatingManual),
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
 * The owner's on/off switch for the guest-facing rating line.
 *
 * Deliberately not "clear the numbers": an owner turning the line off for
 * a fortnight — a disputed review, a refurbishment, a bad week — gets it
 * back by flicking the switch, with the Place ID and the hand-typed
 * numbers exactly where they left them. Off also stops the background
 * refresher, so a hidden line costs nothing at Google either.
 */
export async function updateVenueGoogleRatingEnabled(
  userId: string,
  enabled: boolean,
): Promise<ServiceResult> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({
      where: { id: venue.id },
      data: { googleRatingEnabled: enabled },
    });
    return { ok: true as const, value: undefined };
  });
}

/**
 * Save — or clear — the rating the owner typed in themselves.
 *
 * The fallback for every deployment without a Places API key, which is
 * most of them: the owner reads the two numbers off their own Google
 * Business profile and types them here. Nothing refreshes this value and
 * nothing expires it; a fetched rating simply outranks it the moment one
 * exists (see `publicRating`), so the two can coexist without a race.
 *
 * Both fields are required together. A rating with no count is a star
 * with nothing behind it, and a count with no rating is a number nobody
 * can read — so an EMPTY form is the clear, and a half-filled one is a
 * mistake worth refusing rather than guessing at.
 */
export async function updateVenueGoogleManualRating(
  userId: string,
  input: { rating: string; count: string },
): Promise<ServiceResult> {
  const rating = input.rating.trim();
  const count = input.count.trim();
  const clearing = rating.length === 0 && count.length === 0;
  const parsed = clearing ? null : parseManualRatingInput(rating, count);
  if (!clearing && !parsed) return { ok: false, error: "invalid" };

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({
      where: { id: venue.id },
      data: {
        // `Prisma.DbNull` is SQL NULL in a nullable JSONB column; a bare
        // `null` would store the JSON value `null`, which reads back as a
        // present-but-unparsable rating rather than as no rating.
        googleRatingManual: parsed
          ? ({
              ...parsed,
              updatedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonObject)
          : Prisma.DbNull,
      },
    });
    return { ok: true as const, value: undefined };
  });
}

/** Why the owner's "Refresh rating now" produced no new number. The
 *  Google-side reasons plus the two local ones a session can hit. */
export type VenueRatingRefreshError = RatingError | "no_venue" | "no_place_id";

export type VenueRatingRefreshResult =
  { ok: true; rating: CachedRating } | { ok: false; error: VenueRatingRefreshError };

/**
 * Read this venue's rating from Google right now, cache be damned.
 *
 * The background refresher waits a day between reads because a rating
 * moves slowly and every read is billable. An owner who has just pasted a
 * Place ID is the one case where that wait is wrong: they want to know
 * *this minute* whether the id they chose is the right restaurant, and
 * they can only press the button as often as the limiter allows.
 *
 * Never throws — every failure comes back as a code the settings page
 * turns into a sentence.
 */
export async function refreshVenueGoogleRating(userId: string): Promise<VenueRatingRefreshResult> {
  const venue = await asUser(userId, (tx) =>
    tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, tenantId: true, googlePlaceId: true },
    }),
  );
  if (!venue) return { ok: false, error: "no_venue" };
  if (!venue.googlePlaceId) return { ok: false, error: "no_place_id" };
  const result = await refreshVenueRatingNow(venue.tenantId, venue.id, venue.googlePlaceId);
  return result.ok ? { ok: true, rating: result.cached } : { ok: false, error: result.error };
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
/* Gift cards                                                          */
/* ------------------------------------------------------------------ */

import { giftCardConfigSchema, parseGiftCardConfig, type GiftCardConfig } from "./gift-card-config";

/** The owner's gift-card switches, for the Settings page. Parsed on read
 *  so a half-filled blob still renders a usable form (see
 *  `gift-card-config.ts` — a throwing settings row would take a paid
 *  product off sale). */
export async function getGiftCardSettings(userId: string): Promise<ServiceResult<GiftCardConfig>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { giftCards: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return { ok: true as const, value: parseGiftCardConfig(venue.giftCards) };
  });
}

/** Save the owner's gift-card switches. Same shape as the loyalty save:
 *  the schema is the validator, so a garbage field never lands in JSONB. */
export async function updateVenueGiftCards(userId: string, input: unknown): Promise<ServiceResult> {
  const parsed = giftCardConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    await tx.venue.update({ where: { id: venue.id }, data: { giftCards: parsed.data } });
    return { ok: true as const, value: undefined };
  });
}

/**
 * What the owner may change about one of the three gift-card designs.
 *
 * The list is the point: `sortIndex` is absent, so nothing reachable from
 * a form can reorder the slots, and there is no create — a venue has
 * exactly three designs at slots 0/1/2 (see `ensureGiftCardProducts`),
 * and a fourth would have nowhere to render.
 */
export const giftCardProductPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  // Integer cents, like every other price in this codebase. Zero is not a
  // gift card, and the ceiling is there so a mis-typed "50000" (€500 typed
  // as cents) is refused rather than sold.
  priceCents: z.number().int().min(1).max(100_000).optional(),
  active: z.boolean().optional(),
  // A `media.storageKey` from an upload, or null to fall back to no image.
  imageKey: z.string().trim().min(1).max(512).nullable().optional(),
});

/**
 * Edit one design: rename it, re-price it, swap its picture, take it off
 * sale.
 *
 * Scoped by `asUser`, so RLS already hides other tenants' rows — and the
 * write is an `updateMany` naming this venue rather than an `update` by
 * primary key, so a product id belonging to a SIBLING branch of the same
 * tenant matches nothing instead of being edited from the wrong venue's
 * settings page.
 */
export async function updateGiftCardProduct(
  userId: string,
  productId: string,
  patch: { name?: string; priceCents?: number; active?: boolean; imageKey?: string | null },
): Promise<ServiceResult> {
  if (!productId) return { ok: false, error: "invalid" };
  const parsed = giftCardProductPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;
  if (Object.keys(data).length === 0) return { ok: false, error: "invalid" };

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const updated = await tx.giftCardProduct.updateMany({
      where: { id: productId, venueId: venue.id, deletedAt: null },
      data,
    });
    // Nothing matched: an id from another venue, or one already deleted.
    // "invalid" rather than a silent success — the owner pressed Save and
    // deserves to be told it did not take.
    if (updated.count === 0) return { ok: false, error: "invalid" as const };
    return { ok: true as const, value: undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Contact numbers                                                     */
/* ------------------------------------------------------------------ */

import {
  CONTACT_FIELDS,
  isContactPhoneField,
  normalizeEmail,
  normalizePhone,
  parseContactConfig,
  type ContactConfig,
  type ContactField,
} from "./contact-config";

/** Like `ServiceResult`, plus WHICH number was refused — the settings card
 *  puts the message under that input, and the staff PATCH returns it as
 *  `field`, so neither has to guess from a bare "invalid". */
export type ContactResult<T = undefined> =
  { ok: true; value: T } | { ok: false; error: "no_venue" | "invalid"; field?: ContactField };

/** What the owner has published, raw — E.164 strings or null. The dashboard
 *  card and the app both draw their inputs from this, so a saved number
 *  comes back in the same spelling it was stored in. */
export async function getVenueContact(userId: string): Promise<ContactResult<ContactConfig>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { contact: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return { ok: true as const, value: parseContactConfig(venue.contact) };
  });
}

/**
 * Save the restaurant's numbers.
 *
 * PARTIAL by design: a key that is absent from `input` leaves that number
 * exactly as it was, which is what lets the app's card patch one field and
 * the dashboard's form post all four through the same call.
 *
 * An empty (or whitespace-only) string is the CLEAR — that is how an owner
 * removes a number from a form: they delete the text in the box and press
 * save. A non-empty value that is not a phone number (or, for `email`, not
 * an address) is a refusal naming the field, never a silently dropped
 * value: an owner who mistypes their mobile must not find the slot quietly
 * empty a week later.
 *
 * Nothing is written until every field validates, so a form carrying a good
 * landline and a broken mobile changes neither.
 */
export async function updateVenueContact(
  userId: string,
  input: Partial<Record<ContactField, string | null>>,
): Promise<ContactResult> {
  const patch: Partial<Record<ContactField, string | null>> = {};
  for (const field of CONTACT_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      patch[field] = null;
      continue;
    }
    // Three phone slots and one address: same refusal, different rule.
    const value = isContactPhoneField(field) ? normalizePhone(raw) : normalizeEmail(raw);
    if (value === null) return { ok: false, error: "invalid", field };
    patch[field] = value;
  }

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, contact: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const next = { ...parseContactConfig(venue.contact), ...patch };
    await tx.venue.update({ where: { id: venue.id }, data: { contact: next } });
    return { ok: true as const, value: undefined };
  });
}

/* ------------------------------------------------------------------ */
/* App links ("Get the app")                                           */
/* ------------------------------------------------------------------ */

import {
  APP_LINK_FIELDS,
  normalizeAppLink,
  parseAppLinksConfig,
  type AppLinkField,
  type AppLinksConfig,
} from "./app-links-config";

/** Like `ContactResult`, and for the same reason: the settings card puts
 *  the message under the box that was refused, so "invalid" alone would
 *  leave an owner comparing three URLs by eye. */
export type AppLinkResult<T = undefined> =
  { ok: true; value: T } | { ok: false; error: "no_venue" | "invalid"; field?: AppLinkField };

/** What the owner has published, raw — the three URL strings or null. The
 *  Settings card draws its inputs from this, so a saved link comes back in
 *  the same spelling it was stored in. */
export async function getVenueAppLinks(userId: string): Promise<AppLinkResult<AppLinksConfig>> {
  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { appLinks: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    return { ok: true as const, value: parseAppLinksConfig(venue.appLinks) };
  });
}

/**
 * Save where a guest gets the app.
 *
 * PARTIAL by design, exactly like `updateVenueContact`: a key absent from
 * `input` leaves that link as it was, which is what lets one card post all
 * three and a future JSON client patch one.
 *
 * An empty (or whitespace-only) string is the CLEAR — deleting the text in
 * the box and pressing save is what an owner means by "take that button off
 * the menu". A non-empty value that is not a publishable link is a refusal
 * naming the field, never a silently dropped URL: an owner who pastes their
 * Play listing into the iOS box must be told, not left believing the badge
 * is live.
 *
 * Nothing is written until every field validates, so a form carrying a good
 * App Store link and a broken APK URL changes neither.
 */
export async function updateVenueAppLinks(
  userId: string,
  input: Partial<Record<AppLinkField, string | null>>,
): Promise<AppLinkResult> {
  const patch: Partial<Record<AppLinkField, string | null>> = {};
  for (const field of APP_LINK_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      patch[field] = null;
      continue;
    }
    const url = normalizeAppLink(raw, field);
    if (url === null) return { ok: false, error: "invalid", field };
    patch[field] = url;
  }

  return asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, appLinks: true },
    });
    if (!venue) return { ok: false, error: "no_venue" as const };
    const next = { ...parseAppLinksConfig(venue.appLinks), ...patch };
    await tx.venue.update({ where: { id: venue.id }, data: { appLinks: next } });
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
