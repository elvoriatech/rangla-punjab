import type { Metadata } from "next";
import { FlashMessage } from "@/components/flash-message";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { menuThemeStyle } from "@/lib/menu-themes";
import { uploadedImageUrl } from "@/lib/menu-images";
import { getRestaurantIdentity } from "@/lib/restaurant";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { venueAdminBase } from "@/lib/venue-service";
import { loginAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const identity = await getRestaurantIdentity();
  return { title: `Log in — ${identity?.name ?? BRAND.name}` };
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Please enter a valid email address and password.",
  invalid_credentials: "That email and password combination doesn't match our records.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  no_restaurant:
    "This account isn't linked to a restaurant. Use the owner login, or ask the administrator to run the owner setup.",
};

/**
 * Split-screen login: the restaurant's own world on the left, the form on
 * the right. The left pane disappears below lg — phones get a compact
 * header carrying the same logo and name.
 *
 * This is ONE restaurant's staff door, not a product sign-up, so the panel
 * wears the venue's published menu theme (same vars the guest menu renders
 * with) and talks about their kitchen rather than pitching the software.
 * Falls back to BRAND + the default theme before the venue is seeded —
 * an unseeded deploy must still let the owner log in and fix it.
 *
 * Form mechanics unchanged: plain POST server action, no client JS.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}): Promise<React.ReactElement> {
  // Already signed in → straight to where they work: platform staff to
  // the console, owners to their restaurant.
  const userId = await getSessionUserId();
  if (userId) {
    if (await isPlatformAdmin(userId)) redirect("/admin");
    redirect((await venueAdminBase(userId)) ?? "/dashboard");
  }

  const identity = await getRestaurantIdentity();
  const displayName = identity?.name ?? BRAND.name;
  const logoSrc = identity?.logoKey
    ? uploadedImageUrl(identity.logoKey, 96)
    : "/brand/icon-192.png";
  // The guest menu's palette, reused verbatim — these vars are the ones
  // menu-themes-contrast.test.ts guards, so text on them stays readable
  // whichever theme the owner picked.
  const themeStyle = menuThemeStyle(
    identity?.theme,
    identity?.texture,
    identity?.backdrop,
    identity?.headingColor,
  );

  const { error, reset } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.invalid) : null;
  const noticeMessage = reset ? "Password updated — log in with your new password." : null;

  return (
    <main className="flex min-h-screen bg-cream text-ink">
      {/* Brand pane — the thesis, not a decoration. */}
      {/* The pane itself is no longer aria-hidden: it now holds a real link
          back to the menu, and a focusable control inside an aria-hidden
          subtree is an axe violation. Everything that was only decorative
          or duplicative keeps its own aria-hidden, so the announced output
          is unchanged apart from that one link. */}
      <aside
        style={themeStyle}
        className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-[var(--menu-bg)] p-12 text-[var(--menu-text)] lg:flex"
      >
        {/* Jali-style lattice in the theme's own accent. Drawn with gradients
            rather than an inline SVG so it picks up the CSS variable — a data
            URI cannot read one, which is why the old panel stayed gold on
            every theme. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--menu-accent) 0 1px, transparent 1px 22px)," +
              "repeating-linear-gradient(-45deg, var(--menu-accent) 0 1px, transparent 1px 22px)",
          }}
        />
        <div className="relative">
          {/* The brand mark doubles as the way out: click the restaurant and
              you land on its public menu. */}
          <Link
            href="/"
            aria-label={`${displayName} — back to the menu`}
            className="group inline-flex items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--menu-accent)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="" className="h-11 w-11 rounded-xl object-cover" />
            <span className="text-sm uppercase tracking-[0.34em] text-[var(--menu-accent)] underline-offset-4 group-hover:underline">
              {displayName}
            </span>
          </Link>
          <h2
            aria-hidden="true"
            className="mt-14 max-w-md font-serif text-[2.6rem] font-medium leading-[1.15]"
          >
            Your menu, your kitchen, your tables.
          </h2>
          <p
            aria-hidden="true"
            className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--menu-text-soft)]"
          >
            Change a dish, correct a price, take the evening&apos;s orders — everything{" "}
            {displayName} runs from is behind this door.
          </p>
        </div>

        <ul aria-hidden="true" className="relative space-y-4 text-sm text-[var(--menu-text)]/85">
          {(
            [
              ["🍽", "Edit dishes, prices and photos — live the moment you publish"],
              ["🖥", "Orders arrive here as guests send them from the table"],
              ["🗓", "Reservations and opening hours, on the same screen"],
            ] as const
          ).map(([icon, text]) => (
            <li key={text} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--menu-accent)]/40 text-[13px]">
                {icon}
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>

        <p
          aria-hidden="true"
          className="relative text-[11px] uppercase tracking-[0.3em] text-[var(--menu-text-soft)]/70"
        >
          Staff access · {displayName}
        </p>
      </aside>

      {/* Form pane */}
      <section className="flex flex-1 flex-col justify-center px-6 py-14 sm:px-12">
        <div className="menu-hero mx-auto w-full max-w-sm">
          {/* Compact brand header for screens without the left pane. */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="" className="h-10 w-10 rounded-lg object-cover" />
            <span className="text-xs uppercase tracking-[0.34em] text-gold-dark">
              {displayName}
            </span>
          </div>

          <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">Welcome back</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight">Log in</h1>
          <p className="mt-2 text-sm text-muted">
            Sign in to manage {displayName} — menu, orders and reservations.
          </p>

          {noticeMessage ? <FlashMessage kind="success" text={noticeMessage} /> : null}

          {errorMessage ? <FlashMessage kind="error" text={errorMessage} /> : null}

          <form action={loginAction} className="mt-8 flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Email</span>
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                placeholder="you@yourrestaurant.de"
                className="border border-ink/25 bg-white px-3.5 py-2.5 text-base outline-none transition-colors placeholder:text-ink/30 focus:border-gold-dark focus:ring-2 focus:ring-gold/30"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="flex items-baseline justify-between">
                <span className="font-medium">Password</span>
                <Link
                  href="/reset"
                  className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                >
                  Forgot it?
                </Link>
              </span>
              <input
                type="password"
                name="password"
                required
                maxLength={1024}
                autoComplete="current-password"
                className="border border-ink/25 bg-white px-3.5 py-2.5 text-base outline-none transition-colors focus:border-gold-dark focus:ring-2 focus:ring-gold/30"
              />
            </label>
            <button
              type="submit"
              className="mt-2 bg-orange px-4 py-3.5 text-sm font-semibold uppercase tracking-[0.18em] text-card shadow-[0_10px_24px_-12px_rgba(194,90,34,0.65)] transition hover:bg-orange-dark active:scale-[0.985]"
            >
              Log in
            </button>
          </form>

          {/* Way out for anyone who landed here by accident — the owner asked
              for it. Outlined secondary, same tracking as the primary button
              so the two read as one stack. Plain link: works without JS. */}
          <Link
            href="/"
            className="mt-4 flex items-center justify-center gap-2 border border-ink/25 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted transition-colors hover:border-ink/50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            <span aria-hidden="true">←</span> Back to the menu
          </Link>
        </div>
      </section>
    </main>
  );
}
