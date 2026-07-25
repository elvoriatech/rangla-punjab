import { redirect, permanentRedirect } from "next/navigation";

/**
 * Legacy redirect. The multi-tenant SaaS shape used `/restaurant/{slug}/…`
 * for the owner console; the single-restaurant build moved it to
 * `/dashboard/…`, with the kitchen and print views promoted to top-level
 * `/kitchen` and `/print/…`. This catch-all forwards any old bookmark or
 * indexed link to its new home (301 — the move is permanent).
 */
export default async function LegacyRestaurantRedirect({
  params,
}: {
  params: Promise<{ slug: string; rest?: string[] }>;
}): Promise<never> {
  const { rest } = await params;
  const segments = rest ?? [];

  if (segments[0] === "kitchen") permanentRedirect("/kitchen");
  if (segments[0] === "print") permanentRedirect(`/print/${segments.slice(1).join("/")}`);

  const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
  permanentRedirect(`/dashboard${suffix}`);
  // Unreachable — permanentRedirect throws — but keeps the return type honest.
  redirect("/dashboard");
}
