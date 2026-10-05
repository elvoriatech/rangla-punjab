import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeImage } from "../src/lib/image-normalize";
import { writeUpload } from "../src/lib/image-storage";

/**
 * Give the wines their own category with a picture (owner, 2026-10-05).
 *
 * In the DRAFT menu:
 *   - a "Weine" category is created right after "Alkoholische Getränke"
 *     (translated for the other menu languages), and every wine moves
 *     into it in its current order — a wine is a dish whose description is
 *     "Weißwein", "Rotwein" or "Roséwein", as `merge-alcohol-drinks.ts`
 *     left them;
 *   - each wine gets the picture of its colour (scripts/assets/wine-*.png,
 *     drawn for this menu, no third-party image). A wine that already has
 *     a photo keeps it unless OVERWRITE=1.
 * Nothing is live until the owner presses Publish.
 *
 *   RESTAURANT_SLUG   default "rangla-punjab"
 *   APPLY=1           write; without it the script only prints the plan
 *   OVERWRITE=1       replace photos wines already have
 *
 *   ./deploy/deploy.sh wines            (dry run)
 *   APPLY=1 ./deploy/deploy.sh wines    (write, copy the pictures into the
 *                                        app container, then press Publish)
 *
 * The pictures are written under public/uploads on the machine running the
 * script and their keys listed in `wine-photos.txt`; `deploy.sh wines`
 * copies exactly those files into the app container's uploads volume (the
 * script runs on the host, the volume lives in the container).
 */

const SOURCE = "Alkoholische Getränke";
const TARGET = "Weine";
const TARGET_TRANSLATIONS: Record<string, string> = {
  en: "Wines",
  fr: "Vins",
  es: "Vinos",
  it: "Vini",
  ar: "النبيذ",
};
/** Description → picture. */
export const WINE_ART: Record<string, { file: string; alt: string }> = {
  Weißwein: { file: "wine-white.png", alt: "Ein Glas Weißwein" },
  Rotwein: { file: "wine-red.png", alt: "Ein Glas Rotwein" },
  Roséwein: { file: "wine-rose.png", alt: "Ein Glas Roséwein" },
};
export const KEYS_FILE = "wine-photos.txt";

async function main(): Promise<void> {
  const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
  const apply = process.env.APPLY === "1";
  const overwrite = process.env.OVERWRITE === "1";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const venue = await prisma.venue.findUnique({
      where: { slug },
      select: { id: true, tenantId: true },
    });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);
    // FORCE ROW LEVEL SECURITY on every menu table: reads and writes run
    // with the tenant set.
    const tenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${venue.tenantId}, true)`;
          return fn(tx);
        },
        { timeout: 60_000 },
      );

    const loaded = await tenantTx(async (tx) => {
      const draft = await tx.menuVersion.findFirst({
        where: { status: "draft", menu: { venueId: venue.id, deletedAt: null } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!draft) throw new Error("this restaurant has no draft menu");
      const categories = await tx.category.findMany({
        where: { menuVersionId: draft.id, name: { in: [SOURCE, TARGET] } },
        include: { items: { where: { deletedAt: null }, orderBy: { orderIndex: "asc" } } },
      });
      return { draftId: draft.id, categories };
    });
    const source = loaded.categories.find((c) => c.name === SOURCE);
    const existing = loaded.categories.find((c) => c.name === TARGET);
    if (!source && !existing) throw new Error(`no "${SOURCE}" category in the draft menu`);

    const toMove = (source?.items ?? []).filter((i) => i.description && WINE_ART[i.description]);
    const wines = [...(existing?.items ?? []), ...toMove];
    const needPhoto = wines.filter(
      (w) => w.description && WINE_ART[w.description] && (overwrite || !w.photoMediaId),
    );

    console.log(
      existing
        ? `"${TARGET}" exists — ${existing.items.length} wine(s) already in it.`
        : `"${TARGET}" will be created after "${SOURCE}".`,
    );
    console.log(`${toMove.length} wine(s) move from "${SOURCE}":`);
    for (const w of toMove) console.log(`  → ${w.name} (${w.description})`);
    console.log(`${needPhoto.length} wine(s) get a picture:`);
    for (const w of needPhoto) console.log(`  🖼 ${w.name} — ${WINE_ART[w.description!]!.file}`);
    const kept = wines.length - needPhoto.length;
    if (kept > 0)
      console.log(`${kept} wine(s) keep the photo they already have (OVERWRITE=1 replaces it).`);

    if (!apply) {
      console.log("\nDry run — nothing was changed. Re-run with APPLY=1, then press PUBLISH.");
      return;
    }

    // One stored picture per colour, shared by the wines of that colour.
    const colours = [...new Set(needPhoto.map((w) => w.description!))];
    const stored = new Map<
      string,
      { storageKey: string; width: number; height: number; bytes: number; alt: string }
    >();
    for (const colour of colours) {
      const art = WINE_ART[colour]!;
      const raw = readFileSync(path.join(process.cwd(), "scripts", "assets", art.file));
      const normalized = await normalizeImage(raw, { maxEdge: 1200, webp: true });
      if (!normalized.ok) throw new Error(`could not prepare ${art.file}`);
      const storageKey = `${venue.tenantId}/uploads/${randomUUID()}`;
      await writeUpload(storageKey, normalized.bytes);
      stored.set(colour, {
        storageKey,
        width: normalized.width,
        height: normalized.height,
        bytes: normalized.bytes.length,
        alt: art.alt,
      });
    }

    await tenantTx(async (tx) => {
      let target = existing;
      if (!target) {
        const created = await tx.category.create({
          data: {
            tenantId: venue.tenantId,
            menuVersionId: loaded.draftId,
            name: TARGET,
            orderIndex: source!.orderIndex + 50,
          },
        });
        await tx.translation.createMany({
          data: Object.entries(TARGET_TRANSLATIONS).map(([locale, value]) => ({
            tenantId: venue.tenantId,
            entityType: "category",
            entityId: created.id,
            locale,
            field: "name",
            value,
          })),
        });
        target = { ...created, items: [] };
      }
      let next = (target.items.length + 1) * 100;
      for (const w of toMove) {
        await tx.item.update({
          where: { id: w.id },
          data: { categoryId: target.id, orderIndex: next },
        });
        next += 100;
      }
      const mediaIds = new Map<string, string>();
      for (const [colour, s] of stored) {
        const media = await tx.media.create({
          data: {
            tenantId: venue.tenantId,
            storageKey: s.storageKey,
            width: s.width,
            height: s.height,
            bytes: s.bytes,
            altText: s.alt,
          },
          select: { id: true },
        });
        mediaIds.set(colour, media.id);
      }
      for (const w of needPhoto) {
        await tx.item.update({
          where: { id: w.id },
          data: { photoMediaId: mediaIds.get(w.description!)! },
        });
      }
    });

    writeFileSync(KEYS_FILE, [...stored.values()].map((s) => s.storageKey).join("\n") + "\n");
    console.log(
      `✓ Done in the draft menu: "${TARGET}" with ${wines.length} wine(s), ${needPhoto.length} picture(s) set.\n` +
        `  Picture keys listed in ${KEYS_FILE} for deploy.sh to copy.\n` +
        "  Open the dashboard and press PUBLISH to make it live.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("wine-category.ts")) {
  main().catch((err) => {
    console.error(`✗ wine-category failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
