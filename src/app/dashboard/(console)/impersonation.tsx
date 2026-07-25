import { BRAND } from "@/lib/brand";
import { getSessionInfo, setSessionCookie } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { redirect } from "next/navigation";

/**
 * The "viewing as owner" banner + exit. Rendered by the dashboard
 * layout only when the session carries an impersonation claim; exit
 * restores the admin's own session — but only after re-verifying the
 * claimed admin still has the platform flag (a revoked admin cannot
 * ride an old impersonation cookie back in).
 */

export async function endImpersonationAction(): Promise<void> {
  "use server";
  const info = await getSessionInfo();
  if (!info?.impersonatorId) redirect("/login");
  if (!(await isPlatformAdmin(info.impersonatorId))) redirect("/login");
  await setSessionCookie(info.impersonatorId);
  redirect("/admin");
}

export function ImpersonationBanner(): React.ReactElement {
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 bg-[#7c2d12] px-5 py-2.5 text-sm text-orange-50">
      <span>
        <span aria-hidden="true">👁</span> <strong>{BRAND.name} support view</strong> — you are
        seeing this dashboard as the owner. Session ends automatically after 30 minutes.
      </span>
      <form action={endImpersonationAction}>
        <button
          type="submit"
          className="rounded border border-orange-200/50 px-3 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-orange-50/10"
        >
          Return to admin
        </button>
      </form>
    </div>
  );
}
