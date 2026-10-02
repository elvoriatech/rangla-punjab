import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Reorder the app's home slider — the bulk-free version of the move
 * controls under Dashboard → Settings → App home slider.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   LAST              poster to move to the END (default "welcome", the
 *                     "Unvergesslicher Genuss!" poster). A name from the
 *                     list the dry run prints: points, welcome, giftcard,
 *                     service, catering — or a position, "2".
 *   ORDER             instead of LAST: the whole slider, in order, from
 *                     the built-in posters — e.g.
 *                     ORDER=points,catering,giftcard,service,welcome
 *                     (this is also how a missing poster is put back)
 *   APPLY=1           write; without it the script only prints the plan
 *
 *   ./deploy/deploy.sh slider             (dry run)
 *   APPLY=1 ./deploy/deploy.sh slider     (move it)
 *
 * The app picks the new order up within about a minute (the menu payload
 * is cached for 60 s); no new app build is involved.
 */

/** What a venue that never touched its slider shows (`hero-slides.ts`). */
const DEFAULTS = ["points-de", "welcome-de", "catering-de", "giftcard-de"].map(
  (n) => `builtin:${n}`,
);

/** "builtin:welcome-de" → "welcome"; an upload keeps a short tail. */
export function slideLabel(key: string): string {
  if (key.startsWith("builtin:")) return key.slice("builtin:".length).replace(/-de$/, "");
  return `upload …${key.slice(-10)}`;
}

/** The list with one slide moved to the end, or why it cannot be done. */
export function moveLast(
  slides: readonly string[],
  which: string,
): { ok: true; slides: string[] } | { ok: false; problem: string } {
  const wanted = which.trim().toLowerCase();
  const byPosition = /^\d+$/.test(wanted) ? Number(wanted) - 1 : -1;
  const at = byPosition >= 0 ? byPosition : slides.findIndex((key) => slideLabel(key) === wanted);
  if (at < 0 || at >= slides.length) {
    return { ok: false, problem: `no slide "${which}" in the slider` };
  }
  const next = [...slides];
  const [moved] = next.splice(at, 1);
  next.push(moved!);
  return { ok: true, slides: next };
}

/** The built-in posters (`BUILT_IN_SLIDES` in `src/lib/hero-slides.ts`). */
const BUILT_INS = ["points", "welcome", "giftcard", "service", "catering"];

/** A whole slider from built-in names, or why the list is not usable. */
export function fullOrder(
  raw: string,
): { ok: true; slides: string[] } | { ok: false; problem: string } {
  const names = raw
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  const unknown = names.filter((n) => !BUILT_INS.includes(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      problem: `unknown poster(s) ${unknown.join(", ")} — use ${BUILT_INS.join(", ")}`,
    };
  }
  if (new Set(names).size !== names.length)
    return { ok: false, problem: "a poster is listed twice" };
  if (names.length === 0 || names.length > 6) return { ok: false, problem: "list 1 to 6 posters" };
  return { ok: true, slides: names.map((n) => `builtin:${n}-de`) };
}

async function main(): Promise<void> {
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const apply = process.env.APPLY === "1";
  const which = process.env.LAST ?? "welcome";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const venue = await prisma.venue.findUnique({
      where: { slug },
      select: { id: true, branding: true },
    });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);
    const branding = (venue.branding ?? {}) as Record<string, unknown>;
    const stored = branding.heroSlides;
    const current: string[] =
      stored === undefined
        ? [...DEFAULTS]
        : Array.isArray(stored)
          ? stored.filter((k): k is string => typeof k === "string")
          : [];

    const show = (list: readonly string[]): string =>
      list.map((key, i) => `${i + 1}. ${slideLabel(key)}`).join("   ");
    console.log(`Now:   ${show(current)}`);
    // An uploaded slide has no name to list it by; refuse to drop one.
    const uploads = current.filter((key) => !key.startsWith("builtin:"));
    const order = process.env.ORDER;
    if (order && uploads.length > 0) {
      console.log("✗ The slider holds uploaded slides; ORDER would remove them. Nothing changed.");
      process.exitCode = 1;
      return;
    }
    const plan = order ? fullOrder(order) : moveLast(current, which);
    if (!plan.ok) {
      console.log(`✗ ${plan.problem}. Nothing changed.`);
      process.exitCode = 1;
      return;
    }
    console.log(`After: ${show(plan.slides)}`);
    if (plan.slides.join("|") === current.join("|")) {
      console.log("Already in that order — nothing to do.");
      return;
    }
    if (!apply) {
      console.log("Dry run — nothing was changed. Re-run with APPLY=1 to reorder.");
      return;
    }
    await prisma.venue.update({
      where: { id: venue.id },
      data: { branding: { ...branding, heroSlides: plan.slides } },
    });
    console.log("✓ Slider reordered. The app shows it within about a minute.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("slider-order.ts")) {
  main().catch((err) => {
    console.error(`✗ slider-order failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
