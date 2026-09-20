import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/lib/db";
import { asTenant } from "../src/lib/tenant";
import { purgeMenuForTenant } from "../src/lib/cdn-purge";

/**
 * Load a hand-written menu translation bundle into the `translations`
 * table, so every non-default locale of the public menu stops falling
 * back to German.
 *
 *   pnpm exec tsx --env-file=.env scripts/import-menu-translations.ts \
 *     scripts/data/rangla-menu-translations.json [--dry-run]
 *
 * Contract (mirrors `saveCategoryTranslations` in src/lib/translation-service.ts):
 * one `Translation` row per (entityType, entityId, locale, field), unique
 * on that quadruple, `entityType` "category" | "item", `field` "name" |
 * "description", carrying the owner's `tenantId`. Every read and write
 * runs inside `asTenant`, so RLS scopes this script to the one tenant the
 * venue belongs to exactly like the dashboard does. This is an UPSERT —
 * it never deletes a row, so a translation the owner typed by hand is
 * only ever overwritten with a better one, never dropped.
 *
 * MATCHING. The bundle carries the ids of the PUBLISHED menu it was
 * translated from, but a publish deep-copies the whole tree into fresh
 * rows (see `copyTranslations` in menu-versions-service.ts), and a dev
 * database seeded separately has entirely different ids. So each entity
 * is resolved twice per target version: by id first, then by exact
 * default-locale NAME — item names scoped to their own category, because
 * "Chicken Korma" and "Sabzi Curry" each appear in two categories. Every
 * row is reported as matched by id, matched by name, or skipped.
 *
 * DRAFT AS WELL AS PUBLISHED. Writing only against the published ids
 * would make the translations disappear at the owner's next publish: the
 * publish copies translations from the DRAFT rows onto the new published
 * ids. So the import targets the current published version *and* the
 * live draft (matched by name there). Pass `--published-only` to skip the
 * draft — the translations then live exactly one publish long.
 *
 * CDN. `/`, `/{locale}`, `/api/v1/menu` and `/api/v1/menu?locale=…` are
 * edge-cached, so a fresh translation is invisible until the edge copy is
 * dropped. This script therefore calls `purgeMenuForTenant`
 * (src/lib/cdn-purge.ts) after a successful import — the same helper the
 * dashboard's publish/appearance/settings actions call. With
 * CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN unset it logs a skip and the
 * 5-minute s-maxage in next.config bounds the staleness instead.
 */

const DEFAULT_BUNDLE = path.join(import.meta.dirname, "data", "rangla-menu-translations.json");

interface TranslatedField {
  name?: string;
  description?: string;
}
interface Bundle {
  venueSlug: string;
  sourceLocale: string;
  locales: string[];
  categories: { id: string; source: string; translations: Record<string, TranslatedField> }[];
  items: {
    id: string;
    categoryId?: string;
    source: { name: string; description?: string };
    translations: Record<string, TranslatedField>;
  }[];
}

type MatchKind = "id" | "name" | "skipped";

interface DesiredRow {
  entityType: "category" | "item";
  entityId: string;
  locale: string;
  field: "name" | "description";
  value: string;
}

interface VersionReport {
  label: string;
  categories: Record<MatchKind, number>;
  items: Record<MatchKind, number>;
  skipped: string[];
}

interface TargetItem {
  id: string;
  name: string;
}
interface TargetCategory {
  id: string;
  name: string;
  items: TargetItem[];
}
interface TargetVersion {
  id: string;
  label: string;
  categories: TargetCategory[];
}

function key(row: { entityType: string; entityId: string; locale: string; field: string }): string {
  return `${row.entityType}|${row.entityId}|${row.locale}|${row.field}`;
}

/**
 * Resolve the venue's tenant. The app role sees nothing until the RLS GUC
 * is set and the GUC needs the tenant id — a chicken-and-egg the app
 * itself solves through the session. Here we try the app connection first
 * (works when it is RLS-exempt, e.g. a local dev role) and fall back to
 * the operator/migration connection, which is how the other scripts in
 * this folder — `apply-menu-template.ts`, `seed-rangla-menu.ts` — connect.
 */
async function resolveVenue(
  slug: string,
): Promise<{ id: string; tenantId: string; enabledLocales: string[]; defaultLocale: string }> {
  type Row = { id: string; tenantId: string; enabledLocales: string[]; defaultLocale: string };
  const sql = `
    SELECT id, tenant_id AS "tenantId", enabled_locales AS "enabledLocales",
           default_locale AS "defaultLocale"
    FROM venues WHERE slug = $1 AND "deletedAt" IS NULL LIMIT 1`;

  const direct = await prisma.$queryRawUnsafe<Row[]>(sql, slug);
  if (direct[0]) return direct[0];

  const operatorUrl = process.env.DATABASE_URL;
  if (!operatorUrl) {
    throw new Error(
      `venue "${slug}" not visible on APP_DATABASE_URL (RLS) and DATABASE_URL is not set`,
    );
  }
  const operator = new PrismaClient({ adapter: new PrismaPg({ connectionString: operatorUrl }) });
  try {
    const rows = await operator.$queryRawUnsafe<Row[]>(sql, slug);
    if (!rows[0]) throw new Error(`no venue with slug "${slug}"`);
    return rows[0];
  } finally {
    await operator.$disconnect();
  }
}

/** The versions worth writing to: the live published one + the live draft. */
async function loadTargets(
  tx: Prisma.TransactionClient,
  venueId: string,
  publishedOnly: boolean,
): Promise<TargetVersion[]> {
  const menus = await tx.menu.findMany({
    where: { venueId, deletedAt: null },
    select: { id: true, publishedVersion: true },
  });
  if (menus.length === 0) return [];

  const publishedIds = new Set(
    menus.flatMap((m) => (m.publishedVersion ? [m.publishedVersion] : [])),
  );
  const versions = await tx.menuVersion.findMany({
    where: { menuId: { in: menus.map((m) => m.id) } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      menuId: true,
      categories: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          name: true,
          items: {
            where: { deletedAt: null },
            orderBy: { orderIndex: "asc" },
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  const targets: TargetVersion[] = [];
  const draftSeen = new Set<string>();
  for (const version of versions) {
    if (publishedIds.has(version.id)) {
      targets.push({ id: version.id, label: "published", categories: version.categories });
    } else if (!publishedOnly && version.status === "draft" && !draftSeen.has(version.menuId)) {
      draftSeen.add(version.menuId);
      targets.push({ id: version.id, label: "draft", categories: version.categories });
    }
  }
  return targets;
}

/** Map one bundle onto one version's rows, collecting the rows to write. */
export function planVersion(
  bundle: Bundle,
  version: TargetVersion,
  locales: string[],
): { rows: DesiredRow[]; report: VersionReport } {
  const rows: DesiredRow[] = [];
  const report: VersionReport = {
    label: version.label,
    categories: { id: 0, name: 0, skipped: 0 },
    items: { id: 0, name: 0, skipped: 0 },
    skipped: [],
  };

  const categoryById = new Map(version.categories.map((c) => [c.id, c]));
  const categoryByName = new Map<string, TargetCategory>();
  for (const cat of version.categories)
    if (!categoryByName.has(cat.name)) categoryByName.set(cat.name, cat);
  const usedCategories = new Set<string>();

  const push = (
    entityType: DesiredRow["entityType"],
    entityId: string,
    tr: Record<string, TranslatedField>,
  ): void => {
    for (const locale of locales) {
      const field = tr[locale];
      if (!field) continue;
      if (field.name && field.name.trim() !== "") {
        rows.push({ entityType, entityId, locale, field: "name", value: field.name.trim() });
      }
      if (field.description && field.description.trim() !== "") {
        rows.push({
          entityType,
          entityId,
          locale,
          field: "description",
          value: field.description.trim(),
        });
      }
    }
  };

  const itemsByCategory = new Map<string, Bundle["items"]>();
  for (const item of bundle.items) {
    const parent = item.categoryId ?? "";
    const list = itemsByCategory.get(parent) ?? [];
    list.push(item);
    itemsByCategory.set(parent, list);
  }

  for (const cat of bundle.categories) {
    let target = categoryById.get(cat.id);
    let how: MatchKind = "id";
    if (!target) {
      const byName = categoryByName.get(cat.source);
      if (byName && !usedCategories.has(byName.id)) {
        target = byName;
        how = "name";
      }
    }
    if (!target) {
      const orphaned = itemsByCategory.get(cat.id) ?? [];
      report.categories.skipped += 1;
      report.items.skipped += orphaned.length;
      report.skipped.push(`category "${cat.source}" and its ${orphaned.length} item(s)`);
      continue;
    }
    usedCategories.add(target.id);
    report.categories[how] += 1;
    push("category", target.id, cat.translations);

    const itemById = new Map(target.items.map((i) => [i.id, i]));
    const itemByName = new Map<string, TargetItem>();
    for (const item of target.items)
      if (!itemByName.has(item.name)) itemByName.set(item.name, item);
    const usedItems = new Set<string>();

    for (const item of itemsByCategory.get(cat.id) ?? []) {
      let row = itemById.get(item.id);
      let itemHow: MatchKind = "id";
      if (!row) {
        const byName = itemByName.get(item.source.name);
        if (byName && !usedItems.has(byName.id)) {
          row = byName;
          itemHow = "name";
        }
      }
      if (!row) {
        report.items.skipped += 1;
        report.skipped.push(`item "${item.source.name}" (in "${cat.source}")`);
        continue;
      }
      usedItems.add(row.id);
      report.items[itemHow] += 1;
      push("item", row.id, item.translations);
    }
  }

  // A bundle item whose `categoryId` names no category in the bundle has
  // nothing to scope its name match to, so it is reported rather than
  // guessed at against the whole menu.
  const bundleCategoryIds = new Set(bundle.categories.map((c) => c.id));
  for (const item of bundle.items) {
    if (!bundleCategoryIds.has(item.categoryId ?? "")) {
      report.items.skipped += 1;
      report.skipped.push(`item "${item.source.name}" (no category in the bundle)`);
    }
  }

  return { rows, report };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const publishedOnly = args.includes("--published-only");
  const bundlePath = args.find((a) => !a.startsWith("--")) ?? DEFAULT_BUNDLE;

  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
  console.log(
    `${dryRun ? "[dry-run] " : ""}${path.basename(bundlePath)}: venue "${bundle.venueSlug}", ` +
      `source locale ${bundle.sourceLocale}, target locales ${bundle.locales.join(", ")} ` +
      `(${bundle.categories.length} categories, ${bundle.items.length} items)`,
  );

  const venue = await resolveVenue(bundle.venueSlug);
  console.log(
    `venue ${venue.id} · tenant ${venue.tenantId} · enabled locales ${venue.enabledLocales.join(", ")}`,
  );

  const locales = bundle.locales.filter((l) => l !== venue.defaultLocale);
  const notEnabled = locales.filter((l) => !venue.enabledLocales.includes(l));
  if (notEnabled.length > 0) {
    console.warn(
      `! ${notEnabled.join(", ")} not in the venue's enabled locales — rows are written but the ` +
        `public menu will ignore them until Settings enables the language`,
    );
  }

  const summary = await asTenant(venue.tenantId, async (tx) => {
    const targets = await loadTargets(tx, venue.id, publishedOnly);
    if (targets.length === 0) throw new Error("venue has no menu versions to write to");

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const target of targets) {
      const { rows, report } = planVersion(bundle, target, locales);
      console.log(
        `\n[${report.label} ${target.id}] categories: ${report.categories.id} by id, ` +
          `${report.categories.name} by name, ${report.categories.skipped} skipped · ` +
          `items: ${report.items.id} by id, ${report.items.name} by name, ${report.items.skipped} skipped`,
      );
      for (const line of report.skipped.slice(0, 20)) console.log(`  skipped: ${line}`);
      if (report.skipped.length > 20) console.log(`  … and ${report.skipped.length - 20} more`);

      const entityIds = [...new Set(rows.map((r) => r.entityId))];
      const existing = await tx.translation.findMany({
        where: { entityId: { in: entityIds }, locale: { in: locales } },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          locale: true,
          field: true,
          value: true,
        },
      });
      const existingByKey = new Map(existing.map((r) => [key(r), r]));

      const toCreate: DesiredRow[] = [];
      const toUpdate: { id: string; value: string }[] = [];
      for (const row of rows) {
        const current = existingByKey.get(key(row));
        if (!current) toCreate.push(row);
        else if (current.value !== row.value) toUpdate.push({ id: current.id, value: row.value });
        else unchanged += 1;
      }

      console.log(
        `  ${dryRun ? "would create" : "create"} ${toCreate.length}, ` +
          `${dryRun ? "would update" : "update"} ${toUpdate.length}, unchanged ${
            rows.length - toCreate.length - toUpdate.length
          } (of ${rows.length} translation rows)`,
      );

      if (!dryRun) {
        if (toCreate.length > 0) {
          await tx.translation.createMany({
            data: toCreate.map((r) => ({ tenantId: venue.tenantId, ...r })),
            skipDuplicates: true,
          });
        }
        for (const row of toUpdate) {
          await tx.translation.update({ where: { id: row.id }, data: { value: row.value } });
        }
      }
      created += toCreate.length;
      updated += toUpdate.length;
    }

    return { targets: targets.length, created, updated, unchanged };
  });

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}${summary.targets} menu version(s) · ` +
      `${summary.created} row(s) ${dryRun ? "to create" : "created"}, ` +
      `${summary.updated} ${dryRun ? "to update" : "updated"}, ${summary.unchanged} already correct`,
  );

  if (dryRun) {
    console.log("[dry-run] nothing written, CDN not purged");
  } else {
    const outcome = await purgeMenuForTenant(venue.tenantId);
    console.log(
      outcome === "purged"
        ? "CDN purged (menu pages + /api/v1/menu, all locales)"
        : outcome === "skipped_unconfigured"
          ? "CDN purge skipped — CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN unset. " +
            "Edge copies expire within the 5-minute s-maxage, or purge by hand in the Cloudflare dashboard."
          : "CDN purge FAILED — purge /, /{locale}, /api/v1/menu and /api/v1/menu?locale=… by hand in Cloudflare.",
    );
  }

  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
