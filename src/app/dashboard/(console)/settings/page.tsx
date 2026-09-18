import { BRAND } from "@/lib/brand";
import { FlashMessage } from "@/components/flash-message";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import {
  getOrderingSettings,
  getVenueHours,
  getVenueForUser,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LOCALES,
} from "@/lib/venue-service";
import { PLAN_LABELS } from "@/lib/plan-state";
import { PAYMENT_METHODS } from "@/lib/ordering-config";
import { WEEKDAYS, WEEKDAY_LABELS, formatDay } from "@/lib/opening-hours";
import { uploadedImageUrl } from "@/lib/menu-images";
import { siteUrl } from "@/lib/public-menu";
import { DeliveryAreasEditor } from "./delivery-areas-editor";
import {
  removeBannerAction,
  removeLogoAction,
  saveBannerAction,
  saveHalalAction,
  saveLocalizationAction,
  saveHoursAction,
  saveLogoAction,
  saveOrderingAction,
  saveVenueNameAction,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * Venue settings: name, logo, currency, and menu languages. Every form is
 * plain multipart/POST via server actions — no JS required. Success and
 * error banners are section-specific so the owner knows exactly what
 * saved.
 */

const MESSAGES: Record<string, { saved: string; error: string }> = {
  name: {
    saved: "Name saved. It shows everywhere — menu, QR page, and this dashboard.",
    error: "The name can't be empty. Enter a name up to 120 characters.",
  },
  logo: {
    saved: "Logo saved. Guests see it at the top of your menu.",
    error: "That logo didn't save. Use a JPEG, PNG, or WebP up to 10 MB.",
  },
  "logo-removed": {
    saved: `Logo removed. Your menu shows the ${BRAND.name} mark until you upload a new one.`,
    error: "Couldn't remove the logo — try again.",
  },
  banner: {
    saved: "Banner saved. Guests see it across the top of your menu.",
    error: "That banner didn't save. Use a JPEG, PNG, or WebP up to 10 MB.",
  },
  "banner-removed": {
    saved: "Banner removed. Your menu shows without a hero image.",
    error: "Couldn't remove the banner — try again.",
  },
  hours: {
    saved: "Opening hours saved. Guests see your open/closed status live on the menu.",
    error: "Couldn't save opening hours — check the times and try again.",
  },
  ordering: {
    saved: "Ordering settings saved. Guests see the new options immediately.",
    error: "Couldn't save ordering settings — check the delivery values and try again.",
  },
  halal: {
    saved: "Saved. The Halal filter and badge now match your choice on the public menu.",
    error: "Couldn't save the Halal setting — try again.",
  },
  localization: {
    saved:
      "Currency and languages saved. Prices on the draft use the new currency — publish to show guests.",
    error: "Pick a currency, at least one language, and a default from the enabled languages.",
  },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;
  const orderingResult = await getOrderingSettings(userId);
  const hoursResult = await getVenueHours(userId);
  const venueHours = hoursResult.ok ? hoursResult.value : null;
  const ordering = orderingResult.ok ? orderingResult.value : null;
  const { saved, error } = await searchParams;

  const banner = saved
    ? { kind: "saved" as const, text: MESSAGES[saved]?.saved }
    : error
      ? { kind: "error" as const, text: MESSAGES[error]?.error }
      : null;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 text-ink sm:px-6 md:py-12 lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Settings</p>
      <h1 className="font-serif text-4xl leading-tight">Restaurant details</h1>

      {banner?.text ? (
        <FlashMessage kind={banner.kind === "error" ? "error" : "success"} text={banner.text} />
      ) : null}

      {/* Name */}
      <form action={saveVenueNameAction} className="mt-10 border border-ink/15 bg-card px-6 py-5">
        <label className="block text-sm">
          <span className="font-medium">Restaurant name</span>
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            defaultValue={venue.name}
            className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-base outline-none focus:border-ink"
          />
        </label>
        <p className="mt-2 text-xs text-muted">
          Shown at the top of your public menu and inside this dashboard.
        </p>
        <SubmitButton
          pendingLabel="Saving…"
          className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
        >
          Save name
        </SubmitButton>
      </form>

      {/* Logo */}
      <section aria-label="Logo" className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Logo</p>
        <div className="mt-3 flex items-start gap-5">
          {venue.branding.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadedImageUrl(venue.branding.logoKey, 160)}
              alt={`${venue.name} logo`}
              className="h-20 w-20 shrink-0 rounded-full border border-ink/15 bg-white object-contain p-1"
            />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-dashed border-ink/20 text-center text-[10px] uppercase leading-tight text-muted">
              no logo yet
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              Shown next to your restaurant name at the top of the public menu. Square images look
              best. JPEG, PNG, or WebP up to 10&nbsp;MB.
            </p>
            <form action={saveLogoAction} className="mt-3">
              <input
                type="file"
                name="logo"
                required
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm file:mr-3 file:border file:border-ink/30 file:bg-cream file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
              />
              <SubmitButton
                pendingLabel="Uploading…"
                className="mt-3 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
              >
                Upload logo
              </SubmitButton>
            </form>
            {venue.branding.logoKey ? (
              <form action={removeLogoAction} className="mt-2">
                <SubmitButton
                  pendingLabel="Removing…"
                  className="text-xs text-red-800 underline underline-offset-2 hover:text-red-900"
                >
                  Remove logo
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      {/* Banner */}
      <section aria-label="Banner" className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Top banner</p>
        <div className="mt-3 flex items-start gap-5">
          {venue.branding.bannerKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadedImageUrl(venue.branding.bannerKey, 480)}
              alt={`${venue.name} banner`}
              className="h-20 w-40 shrink-0 border border-ink/15 bg-white object-cover"
            />
          ) : (
            <span className="flex h-20 w-40 shrink-0 items-center justify-center border border-dashed border-ink/20 text-center text-[10px] uppercase leading-tight text-muted">
              no banner yet
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              A wide hero image shown across the top of your public menu — your dining room, a
              signature dish, your storefront. JPEG, PNG, or WebP up to 10&nbsp;MB.
            </p>
            <p className="mt-1 text-xs font-medium text-ink">
              Recommended size: <strong>1600 × 240 pixels</strong> (wide banner strip). The image
              fills the full width and is cropped to fit each screen — keep text and logos near the{" "}
              <em>centre</em>, since phones show the middle part only.
            </p>
            <form action={saveBannerAction} className="mt-3">
              <input
                type="file"
                name="banner"
                required
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm file:mr-3 file:border file:border-ink/30 file:bg-cream file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
              />
              <SubmitButton
                pendingLabel="Uploading…"
                className="mt-3 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
              >
                Upload banner
              </SubmitButton>
            </form>
            {venue.branding.bannerKey ? (
              <form action={removeBannerAction} className="mt-2">
                <SubmitButton
                  pendingLabel="Removing…"
                  className="text-xs text-red-800 underline underline-offset-2 hover:text-red-900"
                >
                  Remove banner
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      {/* Currency + languages */}
      <form action={saveLocalizationAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Currency &amp; languages</p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Currency</span>
            <select
              name="currency"
              defaultValue={venue.currency}
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-base outline-none focus:border-ink"
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              Applies to every dish on the menu. Prices keep their numbers — only the currency
              changes.
            </span>
          </label>

          <label className="block text-sm">
            <span className="font-medium">Default language</span>
            <select
              name="defaultLocale"
              defaultValue={venue.defaultLocale}
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-base outline-none focus:border-ink"
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              The language guests see first. Must be one of the enabled languages below.
            </span>
          </label>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Menu languages</legend>
          <p className="mt-1 text-xs text-muted">
            Guests can switch between enabled languages on the menu. Dishes without a translation
            show the default-language text.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
            {SUPPORTED_LOCALES.map((l) => (
              <label key={l.code} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="enabledLocales"
                  value={l.code}
                  defaultChecked={venue.enabledLocales.includes(l.code)}
                  className="accent-orange"
                />
                <span>
                  {l.label}
                  <span className="ml-1 text-xs uppercase text-muted">{l.code}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <SubmitButton
          pendingLabel="Saving…"
          className="mt-5 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
        >
          Save currency &amp; languages
        </SubmitButton>
      </form>

      {/* Opening hours */}
      {venueHours ? (
        <form action={saveHoursAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">Opening hours</p>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
              {venueHours.timezone}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Shown live on your public menu as Open / Closed. Leave a day&apos;s times blank or tick
            Closed. For a lunch break, use both slots (e.g. 11:00–14:30 and 17:30–22:00). Times past
            midnight are fine (e.g. 17:00–02:00).
          </p>
          <div className="mt-4 space-y-2">
            {WEEKDAYS.map((wd) => {
              const day = venueHours.hours.days[wd];
              const s1 = day?.slots?.[0];
              const s2 = day?.slots?.[1];
              const closed = day?.closed ?? !venueHours.hours.configured;
              return (
                <div
                  key={wd}
                  className="grid grid-cols-[6.5rem_auto] items-center gap-x-3 gap-y-1 border-b border-ink/5 py-1.5 sm:grid-cols-[6.5rem_repeat(4,minmax(0,5.5rem))_auto]"
                >
                  <span className="text-sm font-medium">{WEEKDAY_LABELS[wd]}</span>
                  <input
                    type="time"
                    name={`${wd}_open1`}
                    defaultValue={s1?.open ?? ""}
                    className="border border-ink/25 bg-white px-2 py-1 text-sm"
                  />
                  <input
                    type="time"
                    name={`${wd}_close1`}
                    defaultValue={s1?.close ?? ""}
                    className="border border-ink/25 bg-white px-2 py-1 text-sm"
                  />
                  <input
                    type="time"
                    name={`${wd}_open2`}
                    defaultValue={s2?.open ?? ""}
                    className="border border-ink/25 bg-white px-2 py-1 text-sm"
                  />
                  <input
                    type="time"
                    name={`${wd}_close2`}
                    defaultValue={s2?.close ?? ""}
                    className="border border-ink/25 bg-white px-2 py-1 text-sm"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      name={`${wd}_closed`}
                      defaultChecked={closed}
                      className="accent-orange"
                    />
                    Closed
                  </label>
                </div>
              );
            })}
          </div>
          {venueHours.hours.configured ? (
            <p className="mt-3 text-xs text-muted">
              Current:{" "}
              {WEEKDAYS.map(
                (wd) =>
                  `${WEEKDAY_LABELS[wd].slice(0, 3)} ${formatDay(venueHours.hours.days[wd] ?? { closed: true, slots: [] })}`,
              ).join(" · ")}
            </p>
          ) : null}
          <SubmitButton
            pendingLabel="Saving…"
            className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Save opening hours
          </SubmitButton>
        </form>
      ) : null}

      {/* Ordering */}
      {ordering ? (
        <form action={saveOrderingAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">Guest ordering</p>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
              {ordering.access.state === "trial"
                ? `Trial · ${ordering.access.trialDaysLeft} days left`
                : ordering.access.plan
                  ? `${PLAN_LABELS[ordering.access.plan]} plan`
                  : "No active plan"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            What guests can do from the menu. Greyed-out options aren&apos;t part of your current
            plan — upgrade any time from Billing.
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {(
              [
                [
                  "dineIn",
                  "Dine-in ordering",
                  "Guests order from the table; you bring the food.",
                  ordering.access.entitlements.dineIn,
                  ordering.config.dineIn,
                ],
                [
                  "takeaway",
                  "Takeaway / pickup",
                  "Guests order ahead with name + phone and collect.",
                  ordering.access.entitlements.takeaway,
                  ordering.config.takeaway,
                ],
                [
                  "delivery",
                  "Delivery",
                  "Guests order to an address; pay the driver.",
                  ordering.access.entitlements.delivery,
                  ordering.config.delivery,
                ],
              ] as const
            ).map(([key, label, hint, entitled, enabled]) => (
              <label
                key={key}
                className={
                  entitled
                    ? "flex cursor-pointer items-center justify-between gap-4"
                    : "flex items-center justify-between gap-4 opacity-45"
                }
              >
                <span>
                  {label}
                  {!entitled ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-orange-dark">
                      Growth
                    </span>
                  ) : null}
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
                {/* Toggle switch: the real (sr-only) checkbox keeps the form
                    field name, so the save action parses it unchanged. */}
                <span className="relative inline-flex shrink-0">
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={entitled && enabled}
                    disabled={!entitled}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="h-6 w-11 rounded-full bg-ink/25 transition-colors peer-checked:bg-orange peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange peer-disabled:opacity-50 motion-reduce:transition-none"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 motion-reduce:transition-none"
                  />
                </span>
              </label>
            ))}
          </div>

          {/* Table reservations: a pure owner switch (no plan gate) — a
              restaurant that doesn't take bookings hides the whole
              surface, button and API both. */}
          <div className="mt-4 border-t border-ink/10 pt-4">
            <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
              <span>
                Table reservations
                <span className="block text-xs text-muted">
                  Shows a “Reserve a table” button on your menu. Guests pick a date and time inside
                  your opening hours; you confirm from Reservations.
                </span>
              </span>
              <span className="relative inline-flex shrink-0">
                <input
                  type="checkbox"
                  name="reservations"
                  defaultChecked={ordering.config.reservations}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="h-6 w-11 rounded-full bg-ink/25 transition-colors peer-checked:bg-orange peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange motion-reduce:transition-none"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 motion-reduce:transition-none"
                />
              </span>
            </label>
          </div>

          {ordering.access.entitlements.delivery ? (
            <div className="mt-4 border-t border-ink/10 pt-4">
              <p className="text-sm font-medium">Delivery areas</p>
              <p className="mt-0.5 text-xs text-muted">
                One ZIP per row with its own fee and minimum. Guests pick their ZIP from this list
                at checkout. Type a ZIP and the area name fills in automatically. Use{" "}
                <span className="font-medium">+ Add area</span> to add a row, ✕ to remove one. No
                rows = deliver anywhere
                {ordering.config.deliveryAreas.length === 0 &&
                (ordering.config.deliveryFeeCents > 0 || ordering.config.deliveryMinCents > 0)
                  ? " (flat fee below applies)"
                  : ""}
                .
              </p>
              <DeliveryAreasEditor initial={ordering.config.deliveryAreas} />
              {ordering.config.deliveryAreas.length === 0 ? (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium">Flat delivery fee (€) — no areas defined</span>
                    <input
                      type="number"
                      name="deliveryFee"
                      min={0}
                      step="0.10"
                      defaultValue={(ordering.config.deliveryFeeCents / 100).toFixed(2)}
                      className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Flat minimum order (€)</span>
                    <input
                      type="number"
                      name="deliveryMin"
                      min={0}
                      step="0.50"
                      defaultValue={(ordering.config.deliveryMinCents / 100).toFixed(2)}
                      className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 border-t border-ink/10 pt-4">
            <p className="text-sm font-medium">Payment methods you accept</p>
            <p className="mt-0.5 text-xs text-muted">
              Shown to guests in the menu footer — how they can pay on site or at the door.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {PAYMENT_METHODS.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="acceptedPayments"
                    value={m.id}
                    defaultChecked={ordering.config.acceptedPayments.includes(m.id)}
                    className="accent-orange"
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <SubmitButton
            pendingLabel="Saving…"
            className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Save ordering
          </SubmitButton>
        </form>
      ) : null}

      {/* Diet filters */}
      <form action={saveHalalAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Diet filters</p>
        <p className="mt-1 text-xs text-muted">
          Vegetarian, vegan, gluten-free, and dairy-free filters are always available to guests.
          Halal is your call — enable it only if your kitchen can stand behind it.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="halal"
            defaultChecked={venue.branding.halalFilter === "on"}
            className="accent-orange"
          />
          <span>
            Offer the Halal filter and badge <span className="text-muted">(حلال)</span>
          </span>
        </label>
        <SubmitButton
          pendingLabel="Saving…"
          className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
        >
          Save diet filters
        </SubmitButton>
      </form>

      {/* Web address (read-only) */}
      <section aria-label="Web address" className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Web address</p>
        <p className="mt-1 font-mono text-sm">{siteUrl()}/</p>
        <p className="mt-2 text-xs text-muted">
          Printed QR codes point here, so the address is fixed. Need it changed? Contact support —
          we set up a redirect so old codes keep working.
        </p>
      </section>
    </main>
  );
}
