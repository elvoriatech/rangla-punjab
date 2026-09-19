import { BRAND } from "@/lib/brand";
import { FlashMessage } from "@/components/flash-message";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import {
  getLoyaltySettings,
  getOrderingSettings,
  getVenueAppLinks,
  getVenueContact,
  getVenueGoogle,
  getVenueHours,
  getVenueForUser,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LOCALES,
} from "@/lib/venue-service";
import { PLAN_LABELS } from "@/lib/plan-state";
import { MAX_NOTIFY_EMAILS, PAYMENT_METHODS } from "@/lib/ordering-config";
import { MAX_APP_LINK_LENGTH } from "@/lib/app-links-config";
import { WEEKDAYS, WEEKDAY_LABELS, formatDay } from "@/lib/opening-hours";
import { uploadedImageUrl } from "@/lib/menu-images";
import { siteUrl } from "@/lib/public-menu";
import { DeliveryAreasEditor } from "./delivery-areas-editor";
import type { PlaceSuggestion } from "@/lib/google-rating";
import {
  clearGoogleManualRatingAction,
  refreshGoogleRatingAction,
  saveAppLinksAction,
  removeBannerAction,
  removeLogoAction,
  saveBannerAction,
  saveContactAction,
  saveGoogleAction,
  saveGoogleManualRatingAction,
  saveGoogleRatingEnabledAction,
  searchGooglePlaceAction,
  saveHalalAction,
  saveLocalizationAction,
  saveHoursAction,
  saveLogoAction,
  saveLoyaltyAction,
  saveOrderingAction,
  saveVenueNameAction,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { RequiredLegend, RequiredMark } from "@/components/required-mark";

/**
 * Venue settings: name, logo, currency, and menu languages. Every form is
 * plain multipart/POST via server actions — no JS required. Success and
 * error banners are section-specific so the owner knows exactly what
 * saved.
 */

const MESSAGES: Record<string, { saved?: string; error?: string }> = {
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
  loyalty: {
    saved: "Loyalty saved. Guests see the points line on the cart as soon as it's switched on.",
    error: "Couldn't save loyalty — check the points and amounts and try again.",
  },
  halal: {
    saved: "Saved. The Halal filter and badge now match your choice on the public menu.",
    error: "Couldn't save the Halal setting — try again.",
  },
  // Contact numbers. One success line, and a refusal per box — an owner
  // who mistyped one number needs to know WHICH one, not that "something"
  // was wrong with a card holding three.
  contact: {
    saved: "Contact details saved. Guests can call or message you straight from the menu.",
  },
  contact_landline: {
    error:
      "That landline doesn't look like a phone number. Use digits only — 07531 123456 or +49 7531 123456 — or empty the box to hide it.",
  },
  contact_mobile: {
    error:
      "That mobile doesn't look like a phone number. Use digits only — 0170 1234567 or +49 170 1234567 — or empty the box to hide it.",
  },
  contact_whatsapp: {
    error:
      "That WhatsApp number doesn't look like a phone number. Use the number as it is registered with WhatsApp, or empty the box to hide it.",
  },
  contact_invalid: {
    error: "Couldn't save your contact details — check the three numbers and try again.",
  },
  // "Get the app". Same shape as the contact card: one success line, and a
  // refusal per box that names the link that was refused — pasting the Play
  // listing into the Apple box is the mistake this card exists to catch.
  app: {
    saved: "App links saved. Guests see them in the menu footer, and in the header once set.",
  },
  app_ios: {
    error:
      "That isn't an App Store link. Copy the address of your app's page on the App Store — it starts with https://apps.apple.com/ — or empty the box to hide the badge.",
  },
  app_android: {
    error:
      "That isn't a Google Play link. Copy the address of your app's page on Google Play — it starts with https://play.google.com/ — or empty the box to hide the badge.",
  },
  app_apk: {
    error:
      "That isn't a usable download link. Paste the full https:// address of the .apk file you host, or empty the box to hide the button.",
  },
  app_invalid: {
    error: "Couldn't save your app links — check the three addresses and try again.",
  },
  google: {
    saved:
      "Google Place ID saved. Your rating appears under your name once it's been read — usually the next time a guest opens the menu.",
    error:
      "That doesn't look like a Google Place ID. Copy it from Google's Place ID finder, or leave the field empty to show no rating.",
  },
  // Google lookup outcomes (P7-14). Each one names the thing that is
  // actually wrong AND who can fix it — an owner reading "it didn't work"
  // has no way to tell a missing server key from a typo'd restaurant name.
  google_refreshed: {
    saved: "Rating refreshed from Google. The new number is on your menu right away.",
  },
  google_no_api_key: {
    error:
      "GOOGLE_PLACES_API_KEY is not set on the server (prod.env) — after adding it, recreate the app container (docker compose up -d).",
  },
  google_api_not_enabled: {
    error:
      "Places API (New) is not enabled for this key's Google Cloud project. Enable it in the Cloud console, then try again.",
  },
  google_key_invalid: {
    error:
      "Google rejected the API key. Check GOOGLE_PLACES_API_KEY and any restrictions set on it in the Cloud console.",
  },
  google_quota: {
    error: "Google quota exceeded — try later.",
  },
  google_not_found: {
    error:
      "No place found for that search. Try the restaurant name with the street or city, exactly as it appears on Google Maps.",
  },
  google_network: {
    error: "Couldn't reach Google just now. Try again in a moment.",
  },
  google_unknown: {
    error: "Google's answer wasn't one we understood. Try again, or check the server logs.",
  },
  google_no_place_id: {
    error: "Save a Google Place ID first — there's nothing to refresh yet.",
  },
  google_rate_limited: {
    error: "Too many Google lookups from here. Wait a few minutes and try again.",
  },
  google_manual: {
    saved: "Rating saved. Guests see it under your restaurant name right away.",
    error:
      "Enter a rating between 1.0 and 5.0 (one decimal, e.g. 4.7) and a whole number of reviews — or leave both empty to show nothing.",
  },
  google_rating_visibility: {
    saved: "Saved. Your menu now matches whether the star line should be shown.",
    error: "Couldn't change the rating's visibility — try again.",
  },
  google_manual_cleared: {
    saved: "Rating removed. Your menu shows no star line until you enter one again.",
    error: "Couldn't remove the rating — try again.",
  },
  localization: {
    saved:
      "Currency and languages saved. Prices on the draft use the new currency — publish to show guests.",
    error: "Pick a currency, at least one language, and a default from the enabled languages.",
  },
};

/**
 * The Place ID search results, handed back through the redirect URL (the
 * only place a zero-JS form round-trip can carry them). Everything here
 * arrived in a query string the owner could have typed themselves, so the
 * shape is re-checked and the list re-capped on the way in; React escapes
 * the text itself.
 */
function parsePlaceSuggestions(raw: string | undefined): PlaceSuggestion[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is PlaceSuggestion =>
          !!p &&
          typeof p === "object" &&
          typeof (p as PlaceSuggestion).id === "string" &&
          (p as PlaceSuggestion).id.length > 0,
      )
      .slice(0, 5)
      .map((p) => ({
        id: p.id.slice(0, 255),
        name: String(p.name ?? "").slice(0, 160),
        address: String(p.address ?? "").slice(0, 160),
      }));
  } catch {
    return [];
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    google_search?: string;
    google_q?: string;
  }>;
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
  const loyaltyResult = await getLoyaltySettings(userId);
  const loyalty = loyaltyResult.ok ? loyaltyResult.value : null;
  const googleResult = await getVenueGoogle(userId);
  const google = googleResult.ok ? googleResult.value : null;
  const appLinksResult = await getVenueAppLinks(userId);
  // Raw URLs in the boxes — what the owner sees is what is stored, so
  // saving an untouched form is a no-op.
  const appLinks = appLinksResult.ok ? appLinksResult.value : null;
  const contactResult = await getVenueContact(userId);
  // Raw E.164 in the boxes, not the grouped display string: what the owner
  // sees is what is stored, so saving an untouched form is a no-op.
  const contact = contactResult.ok ? contactResult.value : null;
  // Same fixed dashboard locale + zone as the overview's timestamps: this
  // console is English and runs the restaurant's clock, not the browser's.
  const googleRefreshedLabel = google?.rating
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date(google.rating.fetchedAt))
    : null;
  const { saved, error, google_search: googleSearch, google_q: googleQuery } = await searchParams;
  const placeSuggestions = parsePlaceSuggestions(googleSearch);
  // Prefill the search box with what the owner would have typed anyway.
  // The venue row carries a name but no address, so the name is the whole
  // prefill — the helper text asks for the town, which is what actually
  // disambiguates two restaurants with the same name.
  const placeQuery = googleQuery ?? venue.name;

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
          <span className="font-medium">
            Restaurant name
            <RequiredMark />
          </span>
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
        <RequiredLegend />
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
              <label className="block text-sm">
                <span className="font-medium">
                  Image file
                  <RequiredMark />
                </span>
                <input
                  type="file"
                  name="logo"
                  required
                  accept="image/jpeg,image/png,image/webp"
                  className="mt-1 block w-full text-sm file:mr-3 file:border file:border-ink/30 file:bg-cream file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
                />
              </label>
              <RequiredLegend className="mt-1 text-xs text-muted" />
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
              <label className="block text-sm">
                <span className="font-medium">
                  Image file
                  <RequiredMark />
                </span>
                <input
                  type="file"
                  name="banner"
                  required
                  accept="image/jpeg,image/png,image/webp"
                  className="mt-1 block w-full text-sm file:mr-3 file:border file:border-ink/30 file:bg-cream file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
                />
              </label>
              <RequiredLegend className="mt-1 text-xs text-muted" />
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

      {/* Contact numbers. One form, three boxes: they are one decision
          ("how can a guest reach us?") and posting them together means an
          owner who fixes a typo in one never has to re-enter the others. */}
      <form action={saveContactAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Contact</p>
        <p className="mt-1 text-xs text-muted">
          Guests see these on their account page and in the app; leave a field empty to hide it.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="font-medium">Landline</span>
            <input
              type="tel"
              name="landline"
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              defaultValue={contact?.landline ?? ""}
              placeholder="07531 123456"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Mobile</span>
            <input
              type="tel"
              name="mobile"
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              defaultValue={contact?.mobile ?? ""}
              placeholder="0170 1234567"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">WhatsApp</span>
            <input
              type="tel"
              name="whatsapp"
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              defaultValue={contact?.whatsapp ?? ""}
              placeholder="0170 1234567"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          A German number can be typed either way — 07531 123456 or +49 7531 123456. Numbers are
          saved in international form so calling and WhatsApp work from abroad too.
        </p>
        <SubmitButton
          pendingLabel="Saving…"
          className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
        >
          Save contact
        </SubmitButton>
      </form>

      {/* "Get the app" — App Store, Google Play, direct APK. One form,
          three boxes: they are one decision ("can a guest get our app?"),
          and every box left empty simply hides its own button. */}
      <form action={saveAppLinksAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">App</p>
        <p className="mt-1 text-xs text-muted">
          Shown in the website footer and header once set. Leave empty to hide.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="font-medium">App Store (iOS)</span>
            <input
              type="url"
              name="appIos"
              inputMode="url"
              autoComplete="off"
              maxLength={MAX_APP_LINK_LENGTH}
              defaultValue={appLinks?.ios ?? ""}
              placeholder="https://apps.apple.com/de/app/…"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Google Play (Android)</span>
            <input
              type="url"
              name="appAndroid"
              inputMode="url"
              autoComplete="off"
              maxLength={MAX_APP_LINK_LENGTH}
              defaultValue={appLinks?.android ?? ""}
              placeholder="https://play.google.com/store/apps/details?id=…"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Android .apk file</span>
            <input
              type="url"
              name="appApk"
              inputMode="url"
              autoComplete="off"
              maxLength={MAX_APP_LINK_LENGTH}
              defaultValue={appLinks?.apk ?? ""}
              placeholder="https://example.com/downloads/app.apk"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          The .apk is for guests who install the app directly, without a store — their phone will
          ask them to allow the install. Host the file yourself over https.
        </p>
        <SubmitButton
          pendingLabel="Saving…"
          className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
        >
          Save app links
        </SubmitButton>
      </form>

      {/* Google rating + review link (P7-14). A <section> of sibling
          forms rather than one form: the search, the save, each result's
          "Use this", and the refresh are four different posts, and HTML
          has no nested forms. */}
      <section aria-label="Google" className="mt-6 border border-ink/15 bg-card px-6 py-5">
        <p className="text-sm font-medium">Google</p>
        <p className="mt-1 text-xs text-muted">
          Show your Google star rating under your restaurant name — on the menu and in the app —
          with a link that opens Google&rsquo;s &ldquo;write a review&rdquo; form. Leave the Place
          ID empty to show nothing.
        </p>

        {/* The switch governs everything below it, so it reads first. Its
            own form, because it is a different post from the search, the
            save and the refresh — and HTML has no nested forms. */}
        <form action={saveGoogleRatingEnabledAction} className="mt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="ratingEnabled"
              defaultChecked={google?.enabled ?? true}
              className="accent-orange"
            />
            <span>Show the Google rating to guests</span>
          </label>
          <p className="mt-1 text-xs text-muted">
            Off hides the star line everywhere without losing your Place ID or the numbers below —
            switch it back on and they return as they were.
          </p>
          <SubmitButton
            pendingLabel="Saving…"
            className="mt-3 border border-ink/30 px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] hover:bg-cream"
          >
            Save visibility
          </SubmitButton>
        </form>

        {/* Find my Place ID — the whole setup without leaving this page */}
        <form action={searchGooglePlaceAction} className="mt-4">
          <label className="block text-sm">
            <span className="font-medium">Find my Place ID</span>
            <input
              type="text"
              name="googleQuery"
              maxLength={200}
              autoComplete="off"
              defaultValue={placeQuery}
              placeholder="Restaurant name, street and town"
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <p className="mt-1 text-xs text-muted">
            Search Google for your restaurant — name plus street or town works best — then pick
            yours from the results.
          </p>
          <SubmitButton
            pendingLabel="Searching…"
            className="mt-3 border border-ink/30 px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] hover:bg-cream"
          >
            Search
          </SubmitButton>
        </form>

        {placeSuggestions.length > 0 ? (
          <ul className="mt-4 divide-y divide-ink/10 border border-ink/10">
            {placeSuggestions.map((place) => (
              <li
                key={place.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{place.name || "Unnamed place"}</span>
                  {place.address ? <span className="text-muted"> — {place.address}</span> : null}
                  <span className="mt-0.5 block break-all font-mono text-[11px] text-muted">
                    {place.id}
                  </span>
                </span>
                <form action={saveGoogleAction}>
                  <input type="hidden" name="googlePlaceId" value={place.id} />
                  <SubmitButton
                    pendingLabel="Saving…"
                    className="shrink-0 bg-orange px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
                  >
                    Use this
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : null}

        <form action={saveGoogleAction} className="mt-5 border-t border-ink/10 pt-5">
          <label className="block text-sm">
            <span className="font-medium">Google Place ID</span>
            <input
              type="text"
              name="googlePlaceId"
              inputMode="text"
              maxLength={255}
              autoComplete="off"
              spellCheck={false}
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
              defaultValue={google?.placeId ?? ""}
              className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-ink"
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            Or paste one yourself — Google&rsquo;s own{" "}
            <a
              href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Place ID finder
            </a>{" "}
            shows it for any restaurant on the map.
          </p>
          <SubmitButton
            pendingLabel="Saving…"
            className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Save Place ID
          </SubmitButton>
        </form>

        {google?.rating ? (
          <p className="mt-4 text-sm">
            <span aria-hidden="true" className="text-gold-dark">
              ★
            </span>{" "}
            <strong>{google.rating.rating.toFixed(1)}</strong> · {google.rating.count} reviews ·
            last refreshed {googleRefreshedLabel}
          </p>
        ) : google?.placeId ? (
          <p className="mt-4 text-xs text-muted">
            No rating read yet. Ratings refresh by themselves once a day, the first time somebody
            opens your menu — provided this deployment has a Google Places API key.
          </p>
        ) : null}
        {google?.reviewUrl ? (
          <p className="mt-1 text-xs text-muted">
            Review link:{" "}
            <a
              href={google.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline underline-offset-2"
            >
              {google.reviewUrl}
            </a>
          </p>
        ) : null}
        {google?.placeId ? (
          <form action={refreshGoogleRatingAction} className="mt-3">
            <SubmitButton
              pendingLabel="Asking Google…"
              className="border border-ink/30 px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] hover:bg-cream"
            >
              Refresh rating now
            </SubmitButton>
            <span className="mt-1 block text-xs text-muted">
              Reads Google straight away instead of waiting for the once-a-day refresh — the way to
              check a Place ID you just saved is the right restaurant.
            </span>
          </form>
        ) : null}

        {/* The fallback: type the number in yourself. Every deployment
            without a ⛔ human-gated Places API key lands here, so this is
            the path that actually gets used — it is last in the card only
            because the fetched number is the better one when available. */}
        <div className="mt-5 border-t border-ink/10 pt-5">
          <p className="text-sm font-medium">Enter the rating yourself</p>
          <p className="mt-1 text-xs text-muted">
            Shown when no fetched Google rating is available. Use the exact numbers from your Google
            Business profile.
          </p>
          {google && !google.enabled ? (
            <p className="mt-2 text-xs text-muted">
              The star line is switched off at the top of this card, so guests see nothing at all
              right now — whatever you save here.
            </p>
          ) : null}
          {google?.rating ? (
            <p className="mt-2 text-xs text-muted">
              Right now the rating fetched from Google ({google.rating.rating.toFixed(1)} ·{" "}
              {google.rating.count} reviews) is what guests see — it always wins over the numbers
              below.
            </p>
          ) : null}

          <form action={saveGoogleManualRatingAction} className="mt-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium">Rating</span>
                <input
                  type="text"
                  name="manualRating"
                  inputMode="decimal"
                  maxLength={4}
                  autoComplete="off"
                  placeholder="4.7"
                  defaultValue={google?.manual ? google.manual.rating.toFixed(1) : ""}
                  className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                />
                <span className="mt-1 block text-xs text-muted">
                  Between 1.0 and 5.0, one decimal.
                </span>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Reviews</span>
                <input
                  type="text"
                  name="manualCount"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="off"
                  placeholder="440"
                  defaultValue={google?.manual ? String(google.manual.count) : ""}
                  className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                />
                <span className="mt-1 block text-xs text-muted">
                  How many reviews that average is from.
                </span>
              </label>
            </div>
            <SubmitButton
              pendingLabel="Saving…"
              className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
            >
              Save rating
            </SubmitButton>
          </form>

          {google?.manual ? (
            <form action={clearGoogleManualRatingAction} className="mt-3">
              <SubmitButton
                pendingLabel="Removing…"
                className="border border-ink/30 px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] hover:bg-cream"
              >
                Clear rating
              </SubmitButton>
            </form>
          ) : null}
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

          <div className="mt-4 border-t border-ink/10 pt-4">
            <label className="block text-sm">
              <span className="font-medium">New-order email alerts</span>
              <span className="mt-0.5 block text-xs text-muted">
                Every new order lands in these inboxes as a kitchen ticket — cash orders the moment
                they&apos;re placed, card and PayPal orders once they&apos;re paid. Up to{" "}
                {MAX_NOTIFY_EMAILS} addresses, separated by commas. Leave empty to turn alerts off.
              </span>
              <textarea
                name="notifyEmails"
                rows={2}
                autoComplete="off"
                spellCheck={false}
                placeholder="kueche@example.de, chef@example.de"
                defaultValue={ordering.config.notifyEmails.join(", ")}
                className="mt-2 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
          </div>

          <div className="mt-4 border-t border-ink/10 pt-4">
            <label className="block text-sm">
              <span className="font-medium">Problem reports</span>
              <span className="mt-0.5 block text-xs text-muted">
                Guests can report a problem within this many hours after the order (or after its
                scheduled time, for a pre-order). A conversation that is already open stays usable
                afterwards — this only limits how long a new one can be started.
              </span>
              <span className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  name="issueWindowHours"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={ordering.config.issueWindowHours}
                  className="w-24 border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                />
                <span className="text-sm text-muted">hours</span>
              </span>
            </label>
          </div>

          <div className="mt-4 border-t border-ink/10 pt-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="appCancelEnabled"
                defaultChecked={ordering.config.appCancelEnabled}
                className="mt-0.5 accent-orange"
              />
              <span>
                <span className="font-medium">Allow cancelling orders from the app (Board)</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Off by default — the dashboard&apos;s Orders page can always cancel. Cancelling
                  cannot be undone, and the button is easy to hit by mistake on a phone carried
                  through a service.
                </span>
              </span>
            </label>
          </div>

          <SubmitButton
            pendingLabel="Saving…"
            className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Save ordering
          </SubmitButton>
        </form>
      ) : null}

      {/* Loyalty */}
      {loyalty ? (
        <form action={saveLoyaltyAction} className="mt-6 border border-ink/15 bg-card px-6 py-5">
          <p className="text-sm font-medium">Loyalty</p>
          <p className="mt-1 text-xs text-muted">
            Reward regulars with points. Points are earned per <em>order</em>, not per dish — one
            qualifying order is worth the same whether it&apos;s one curry or five. Guests must be
            signed in to collect; everyone else just sees an invitation to sign in.
          </p>

          <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 text-sm">
            <span>
              Collect points
              <span className="block text-xs text-muted">
                Off means guests see nothing at all — no cart line, no rewards card.
              </span>
            </span>
            <span className="relative inline-flex shrink-0">
              <input
                type="checkbox"
                name="loyaltyEnabled"
                defaultChecked={loyalty.enabled}
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

          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-ink/10 pt-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Minimum order to earn (€)</span>
              <input
                type="number"
                name="loyaltyMinOrder"
                min={0}
                step="0.50"
                defaultValue={(loyalty.minOrderCents / 100).toFixed(2)}
                className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <span className="mt-1 block text-xs text-muted">
                Food only — the delivery fee never counts towards this.
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Points per qualifying order</span>
              <input
                type="number"
                name="loyaltyPointsPerOrder"
                min={0}
                step="1"
                defaultValue={loyalty.pointsPerOrder}
                className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <span className="mt-1 block text-xs text-muted">
                A flat number, however big the order is.
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Points needed for a reward</span>
              <input
                type="number"
                name="loyaltyRewardPoints"
                min={1}
                step="1"
                defaultValue={loyalty.rewardPoints}
                className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <span className="mt-1 block text-xs text-muted">
                {loyalty.pointsPerOrder > 0
                  ? `About ${Math.ceil(loyalty.rewardPoints / loyalty.pointsPerOrder)} orders at today's rate.`
                  : "Set points per order above first."}
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Reward is worth (€)</span>
              <input
                type="number"
                name="loyaltyRewardValue"
                min={0}
                step="0.50"
                defaultValue={(loyalty.rewardValueCents / 100).toFixed(2)}
                className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <span className="mt-1 block text-xs text-muted">
                The free-meal value of one voucher.
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Voucher expires after</span>
              <select
                name="loyaltyExpiryMonths"
                defaultValue={String(loyalty.voucherExpiryMonths)}
                className="mt-1 w-full border border-ink/30 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              >
                <option value="0">End of the month it was earned</option>
                <option value="1">End of the following month</option>
                <option value="2">End of the month after that</option>
                <option value="3">3 months later</option>
                <option value="6">6 months later</option>
                <option value="12">12 months later</option>
              </select>
              <span className="mt-1 block text-xs text-muted">
                Always the last second of that month, in your restaurant&apos;s timezone.
              </span>
            </label>
          </div>

          <SubmitButton
            pendingLabel="Saving…"
            className="mt-4 bg-orange px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-card hover:bg-orange-dark"
          >
            Save loyalty
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
