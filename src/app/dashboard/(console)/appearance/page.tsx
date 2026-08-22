import { redirect } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import {
  MENU_THEMES,
  MENU_TEXTURES,
  MENU_BACKDROPS,
  menuThemeStyle,
  resolveBackdropGradient,
  resolveMenuTheme,
  textureBackgroundImage,
  type MenuTheme,
  type MenuTexture,
  type MenuBackdrop,
} from "@/lib/menu-themes";
import { signPreviewToken } from "@/lib/preview-token";
import { saveAppearanceAction } from "./actions";

/**
 * Appearance — how the public menu looks. Each theme card is a miniature
 * live rendering built from the same CSS vars the real page uses, so what
 * the owner picks is exactly what guests get. Radios + one Save button:
 * works without JS, keyboard-navigable, nothing to learn.
 */

export default async function AppearancePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;

  const { saved, error } = await searchParams;
  const currentTheme = resolveMenuTheme(venue.branding.theme);
  const currentTextureId = venue.branding.texture ?? "none";
  const currentBackdropId = venue.branding.backdrop ?? "none";
  const currentHeadingColor = venue.branding.headingColor;
  const headingPresetHexes = HEADING_COLOR_PRESETS.map((c) => c.hex);
  const headingChecked = !currentHeadingColor
    ? "default"
    : headingPresetHexes.includes(currentHeadingColor)
      ? currentHeadingColor
      : "custom";
  const previewUrl = `/?preview=${signPreviewToken(venue.tenantId, venue.id)}`;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12 text-ink lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Appearance</p>
      <h1 className="font-serif text-4xl leading-tight">Set the table</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Pick the theme and paper texture guests see when they scan. Changes go live the moment you
        save — no republish needed.
      </p>

      {saved ? (
        <FlashMessage
          kind="success"
          text="Appearance saved. Guests see the new look on their next scan."
        />
      ) : null}
      {error ? (
        <FlashMessage
          kind="error"
          text="That didn't save — please pick a theme and texture from the options below."
        />
      ) : null}

      <div className="mt-10 grid grid-cols-1 gap-10 xl:grid-cols-[1fr_minmax(0,340px)]">
        <form action={saveAppearanceAction}>
          <fieldset>
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">Theme</legend>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {MENU_THEMES.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} checked={theme.id === currentTheme.id} />
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Card borders
            </legend>
            <p className="mt-2 max-w-xl text-sm text-muted">
              The thin outline around dish cards. Turn it off for a softer look — cards then
              separate by shadow alone.
            </p>
            <div className="mt-4 flex gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cardBorders"
                  value="on"
                  defaultChecked={(venue.branding.cardBorders ?? "on") === "on"}
                />
                With border
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cardBorders"
                  value="off"
                  defaultChecked={venue.branding.cardBorders === "off"}
                />
                Borderless
              </label>
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Background texture
            </legend>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {MENU_TEXTURES.map((texture) => (
                <TextureCard
                  key={texture.id}
                  texture={texture}
                  theme={currentTheme}
                  checked={texture.id === currentTextureId}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Texture swatches are shown on your current theme&apos;s colors.
            </p>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Background artwork
            </legend>
            <p className="mt-1 text-xs text-muted">
              A full-page artwork behind your menu — it replaces the texture. Dish cards keep their
              solid color so everything stays readable.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {MENU_BACKDROPS.map((backdrop) => (
                <BackdropCard
                  key={backdrop.id}
                  backdrop={backdrop}
                  theme={currentTheme}
                  checked={backdrop.id === currentBackdropId}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Heading color
            </legend>
            <p className="mt-1 text-xs text-muted">
              The color of your category headings. Pick one that reads well on your artwork —
              &ldquo;Theme default&rdquo; uses each theme&apos;s own heading color.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-card px-3 py-1.5 text-sm has-[:checked]:border-orange/60 has-[:checked]:shadow-[0_2px_8px_-4px_rgba(194,90,34,0.4)]">
                <input
                  type="radio"
                  name="headingColor"
                  value="default"
                  defaultChecked={headingChecked === "default"}
                  className="accent-orange"
                />
                <span>Theme default</span>
              </label>
              {HEADING_COLOR_PRESETS.map((preset) => (
                <label
                  key={preset.hex}
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-card px-3 py-1.5 text-sm has-[:checked]:border-orange/60 has-[:checked]:shadow-[0_2px_8px_-4px_rgba(194,90,34,0.4)]"
                >
                  <input
                    type="radio"
                    name="headingColor"
                    value={preset.hex}
                    defaultChecked={headingChecked === preset.hex}
                    className="accent-orange"
                  />
                  <span
                    aria-hidden="true"
                    className="inline-block h-4 w-4 rounded-full border border-ink/20"
                    style={{ backgroundColor: preset.hex }}
                  />
                  <span>{preset.label}</span>
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-card px-3 py-1.5 text-sm has-[:checked]:border-orange/60 has-[:checked]:shadow-[0_2px_8px_-4px_rgba(194,90,34,0.4)]">
                <input
                  type="radio"
                  name="headingColor"
                  value="custom"
                  defaultChecked={headingChecked === "custom"}
                  className="accent-orange"
                />
                <span>Custom</span>
                <input
                  type="color"
                  name="headingColorCustom"
                  defaultValue={headingChecked === "custom" ? currentHeadingColor : "#fdf3dd"}
                  aria-label="Custom heading color"
                  className="h-6 w-9 cursor-pointer rounded border border-ink/20 bg-transparent p-0"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Category labels
            </legend>
            <p className="mt-1 text-xs text-muted">
              With icons on, each category shows its uploaded photo — or a fitting icon we pick from
              the name (🥟 starters, 🍲 soups, 🍗 chicken, …).
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="categoryIcons"
                  value="names"
                  defaultChecked={(venue.branding.categoryIcons ?? "names") === "names"}
                  className="accent-orange"
                />
                <span>Names only (default)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="categoryIcons"
                  value="icons"
                  defaultChecked={venue.branding.categoryIcons === "icons"}
                  className="accent-orange"
                />
                <span>Icons + names</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Category navigation
            </legend>
            <p className="mt-1 text-xs text-muted">
              Where the category list sits on large screens (desktop and tablet landscape). Phones
              always keep the top bar — there is no room for a side rail.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="navLayout"
                  value="top"
                  defaultChecked={(venue.branding.navLayout ?? "top") === "top"}
                  className="accent-orange"
                />
                <span>Top bar (default)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="navLayout"
                  value="side"
                  defaultChecked={venue.branding.navLayout === "side"}
                  className="accent-orange"
                />
                <span>Side rail — best for long menus</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="text-xs uppercase tracking-[0.28em] text-gold-dark">
              Self-order kiosk screen
            </legend>
            <p className="mt-1 text-xs text-muted">
              For a large vertical touchscreen in your restaurant where guests order themselves.
              Open your normal menu link on the screen&apos;s browser in fullscreen — on displays
              that big, the menu fills the width and everything gets finger-sized. Phones and
              laptops are never affected.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kiosk"
                  value="lg"
                  defaultChecked={(venue.branding.kiosk ?? "lg") === "lg"}
                  className="accent-orange"
                />
                <span>Large (default)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kiosk"
                  value="xl"
                  defaultChecked={venue.branding.kiosk === "xl"}
                  className="accent-orange"
                />
                <span>Extra large — reads from further away</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kiosk"
                  value="off"
                  defaultChecked={venue.branding.kiosk === "off"}
                  className="accent-orange"
                />
                <span>Off</span>
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            className="mt-10 bg-orange px-6 py-3 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Save appearance
          </button>
        </form>

        <aside aria-label="Live preview" className="xl:sticky xl:top-10 xl:self-start">
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Live preview</h2>
          <p className="mt-2 text-xs text-muted">
            Your draft menu, exactly as a phone renders it. Reloads when you save.
          </p>
          <div className="mt-4 overflow-hidden rounded-[28px] border-8 border-espresso bg-espresso shadow-[0_24px_48px_-24px_rgba(28,19,11,0.5)]">
            <iframe src={previewUrl} title="Menu preview" className="h-[560px] w-full bg-cream" />
          </div>
        </aside>
      </div>
    </main>
  );
}

/**
 * A miniature of the real menu page: same vars, same serif, same hairline.
 * Not a screenshot — it can never drift from what the renderer produces.
 */
function ThemeCard({ theme, checked }: { theme: MenuTheme; checked: boolean }): React.ReactElement {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name="theme"
        value={theme.id}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <span className="block border border-ink/15 bg-card transition-all peer-checked:border-orange peer-checked:shadow-[0_0_0_1px_var(--color-orange)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange">
        <span
          aria-hidden="true"
          className="block px-5 py-4"
          style={{ ...menuThemeStyle(theme.id, null), backgroundColor: theme.vars.bg }}
        >
          <span className="block font-serif text-lg italic" style={{ color: theme.vars.accent }}>
            La Carta
          </span>
          {theme.layout === "showcase" || theme.layout === "floating" ? (
            /* Round photo, centered name + price badge — chalkboard look. */
            <span className="mt-2 flex flex-col items-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/dish_2.png"
                alt=""
                className="h-14 w-14 rounded-full border object-cover"
                style={{ borderColor: theme.vars.line }}
              />
              <span className="mt-1.5 block font-serif text-sm" style={{ color: theme.vars.text }}>
                Saffron risotto
              </span>
              <span
                className="mt-1 inline-block border px-2 py-0.5 text-[11px]"
                style={{ color: theme.vars.accent, borderColor: theme.vars.accent }}
              >
                18,00 €
              </span>
            </span>
          ) : theme.layout === "list" ? (
            /* Rounded food photo + dotted leader to the price — card row. */
            <span className="mt-2 flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/dish_2.png"
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg border object-cover"
                style={{ borderColor: theme.vars.line }}
              />
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="font-serif text-sm" style={{ color: theme.vars.text }}>
                  Saffron risotto
                </span>
                <span
                  className="flex-1 border-b border-dotted"
                  style={{ borderColor: theme.vars.textSoft }}
                />
                <span className="font-serif text-sm" style={{ color: theme.vars.accent }}>
                  18,00 €
                </span>
              </span>
            </span>
          ) : theme.layout === "grid" || theme.layout === "hero" ? (
            /* Photo-top mini card — mirrors the grid layout. */
            <span
              className="mx-auto mt-2 block w-32 overflow-hidden rounded-sm border"
              style={{ borderColor: theme.vars.line, backgroundColor: theme.vars.surface }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/dish_2.png" alt="" className="block h-16 w-full object-cover" />
              <span className="block px-2 py-1.5 text-center">
                <span className="block text-[11px] font-medium" style={{ color: theme.vars.text }}>
                  Saffron risotto
                </span>
                <span
                  className="block text-[11px] font-semibold"
                  style={{ color: theme.vars.text }}
                >
                  18,00 €
                </span>
              </span>
            </span>
          ) : (
            /* Photo-left mini row ON the theme's card surface — mirrors
               the editorial guest layout, where dish rows sit on
               var(--menu-surface) cards (cream on Rangla Royal). */
            <span
              className="mt-2 flex items-center gap-3 overflow-hidden rounded-lg border p-2"
              style={{ backgroundColor: theme.vars.surface, borderColor: theme.vars.line }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/dish_2.png"
                alt=""
                className="h-12 w-12 shrink-0 rounded-sm object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className="font-serif text-sm"
                    style={{ color: theme.vars.surfaceText ?? theme.vars.text }}
                  >
                    Saffron risotto
                  </span>
                  <span
                    className="font-serif text-sm"
                    style={{ color: theme.vars.surfaceAccent ?? theme.vars.accent }}
                  >
                    18,00 €
                  </span>
                </span>
                <span
                  className="mt-0.5 block text-[10px] leading-relaxed"
                  style={{ color: theme.vars.surfaceTextSoft ?? theme.vars.textSoft }}
                >
                  Carnaroli, cardamom butter, gold leaf
                </span>
              </span>
            </span>
          )}
          <span className="mt-3 block h-px" style={{ backgroundColor: theme.vars.line }} />
        </span>
        <span className="block px-5 py-3">
          <span className="block text-sm font-medium">{theme.label}</span>
          <span className="mt-0.5 block text-xs text-muted">{theme.tagline}</span>
        </span>
      </span>
    </label>
  );
}

/** Curated heading-color chips; "custom" opens a free color input. */
const HEADING_COLOR_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: "#fdf3dd", label: "Cream" },
  { hex: "#e8c15c", label: "Gold" },
  { hex: "#35200f", label: "Espresso" },
  { hex: "#9d1c1c", label: "Punjabi Red" },
  { hex: "#0a2342", label: "Navy" },
  { hex: "#ffffff", label: "White" },
] as const;

/** Backdrop swatch: the artwork itself (or the plain theme color for "none"). */
function BackdropCard({
  backdrop,
  theme,
  checked,
}: {
  backdrop: MenuBackdrop;
  theme: MenuTheme;
  checked: boolean;
}): React.ReactElement {
  return (
    <label className="relative block h-full cursor-pointer">
      <input
        type="radio"
        name="backdrop"
        value={backdrop.id}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-2 z-10 hidden rounded-full bg-orange px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-card shadow-sm peer-checked:inline-block"
      >
        Active
      </span>
      <span className="flex h-full flex-col overflow-hidden rounded-xl border border-ink/10 bg-card shadow-[0_1px_2px_rgba(28,19,11,0.04)] transition-all hover:border-ink/15 peer-checked:border-orange/60 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange">
        <span
          aria-hidden="true"
          className="block h-24 shrink-0"
          style={{
            backgroundColor: theme.vars.bg,
            ...(backdrop.image
              ? {
                  backgroundImage: `url("${backdrop.image}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {}),
            ...(!backdrop.image && resolveBackdropGradient(backdrop, theme.vars.bg)
              ? { backgroundImage: resolveBackdropGradient(backdrop, theme.vars.bg)! }
              : {}),
          }}
        />
        <span className="flex flex-1 flex-col px-3 py-2">
          <span className="block text-sm font-medium">{backdrop.label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted line-clamp-2">
            {backdrop.tagline}
          </span>
        </span>
      </span>
    </label>
  );
}

function TextureCard({
  texture,
  theme,
  checked,
}: {
  texture: MenuTexture;
  theme: MenuTheme;
  checked: boolean;
}): React.ReactElement {
  const backgroundImage = textureBackgroundImage(texture.id, theme) ?? undefined;
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name="texture"
        value={texture.id}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <span className="block border border-ink/15 bg-card transition-all peer-checked:border-orange peer-checked:shadow-[0_0_0_1px_var(--color-orange)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange">
        <span
          aria-hidden="true"
          className="block h-20"
          style={{ backgroundColor: theme.vars.bg, backgroundImage }}
        />
        <span className="block px-3 py-2">
          <span className="block text-sm font-medium">{texture.label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">
            {texture.tagline}
          </span>
        </span>
      </span>
    </label>
  );
}
