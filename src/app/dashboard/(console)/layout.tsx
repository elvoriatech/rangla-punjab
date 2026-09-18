import { redirect } from "next/navigation";
import { NoActiveTenantError } from "@/lib/tenant";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { getSessionInfo, getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { getActiveVenueId, listOwnerVenues } from "@/lib/active-venue";
import { uploadedImageUrl } from "@/lib/menu-images";
import { menuThemeStyle } from "@/lib/menu-themes";
import { prisma } from "@/lib/db";
import { getMenuStatus } from "@/lib/menu-versions-service";
import { DashboardRail } from "./rail";
import { MobileNav } from "./mobile-nav";
import { ImpersonationBanner } from "./impersonation";
import { VerifyEmailBanner } from "./verify-banner";

/**
 * Dashboard shell — the rail on the left wears the venue's own menu
 * theme (same CSS vars the public page uses), so the dashboard always
 * feels like the restaurant that owns it; the work surface stays cream
 * for readable admin forms. Server component: session + venue resolve
 * here once so every page under /dashboard inherits the guard.
 */

function buildNav(base: string) {
  return [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/orders`, label: "Orders" },
    { href: "/kitchen", label: "Kitchen", newTab: true },
    { href: `${base}/categories`, label: "Menu" },
    { href: `${base}/appearance`, label: "Appearance" },
    { href: `${base}/reports`, label: "Reports" },
    { href: `${base}/qr`, label: "QR codes" },
    { href: `${base}/settings`, label: "Settings" },
    { href: `${base}/billing`, label: "Billing" },
  ] as const;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const sessionInfo = await getSessionInfo();

  // Single-restaurant deploy: the console always shows the session user's
  // own venue — no slug in the URL to reconcile.
  let venueResult: Awaited<ReturnType<typeof getVenueForUser>>;
  try {
    venueResult = await getVenueForUser(userId);
  } catch (err) {
    // An account with no restaurant (the platform admin, or a stray
    // signup) is not a server error: send admins to their console and
    // everyone else to the login with a message, instead of the error page.
    if (err instanceof NoActiveTenantError) {
      if (await isPlatformAdmin(userId)) redirect("/admin");
      redirect("/login?error=no_restaurant");
    }
    throw err;
  }
  // A missing venue on a live tenant would loop here forever; the login
  // message is the honest answer.
  if (!venueResult.ok) redirect("/login?error=no_restaurant");
  const venue = venueResult.value;
  // Branch switcher data: only meaningful when the tenant owns >1 venue.
  const [venues, activeVenueId] = await Promise.all([
    listOwnerVenues(userId),
    getActiveVenueId(userId),
  ]);
  const NAV = buildNav("/dashboard");
  // The rail dresses itself in the venue's chosen menu theme.
  const railStyle = menuThemeStyle(venue.branding.theme, venue.branding.texture);
  const logoUrl = venue.branding.logoKey ? uploadedImageUrl(venue.branding.logoKey, 96) : null;
  // Unverified owners get a persistent (non-blocking) nudge — signup
  // never gates on the email link, but recovery + notifications do.
  const account = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true, emailVerifiedAt: true },
  });
  // Publish state for the rail's button: enabled only while the draft
  // holds edits guests can't see yet.
  const menuStatus = await getMenuStatus(userId);

  return (
    <>
      {sessionInfo?.impersonatorId ? <ImpersonationBanner /> : null}
      {account && !account.emailVerifiedAt ? <VerifyEmailBanner email={account.email} /> : null}
      <div className="flex min-h-screen bg-cream">
        <DashboardRail
          base="/dashboard"
          venueName={venue.name}
          logoUrl={logoUrl}
          railStyle={railStyle}
          canPublish={menuStatus.hasUnpublishedChanges}
          everPublished={Boolean(menuStatus.publishedAt)}
          venues={venues}
          activeVenueId={activeVenueId}
        />

        {/* Mobile top bar — hamburger toggles the nav drawer. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav
            items={NAV.map((i) => ({
              href: i.href,
              label: i.label,
              newTab: "newTab" in i ? i.newTab : undefined,
            }))}
            venueName={venue.name}
            logoUrl={logoUrl}
            railStyle={railStyle}
          />
          <div className="console-readable min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </>
  );
}
