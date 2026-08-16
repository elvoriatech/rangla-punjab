import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { AdminLogoutButton } from "./logout-button";
import { AdminSidebar } from "./sidebar";

/**
 * Platform-admin shell: dark control-room chrome with a fixed sidebar,
 * deliberately unlike the warm restaurant dashboard so the two are
 * never mistaken for each other. The gate lives here once — non-staff
 * get a 404 (not a 403) so the URL confirms nothing.
 */

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/restaurants", label: "Restaurants" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/runbooks", label: "Runbooks" },
  { href: "/admin/system", label: "System" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (!(await isPlatformAdmin(userId))) notFound();

  return (
    <div className="console-readable flex min-h-screen bg-admin-bg text-neutral-200">
      <AdminSidebar />

      <div className="min-w-0 flex-1">
        {/* Compact top nav for small screens. */}
        <nav
          aria-label="Admin"
          className="flex gap-1 overflow-x-auto border-b border-white/10 px-4 py-3 text-xs md:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full border border-white/15 px-3 py-1.5 text-neutral-300"
            >
              {item.label}
            </Link>
          ))}
          <AdminLogoutButton className="whitespace-nowrap rounded-full border border-white/15 px-3 py-1.5 text-neutral-300" />
        </nav>
        {children}
      </div>
    </div>
  );
}
