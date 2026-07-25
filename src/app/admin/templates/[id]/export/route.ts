import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { adminGetTemplate } from "@/lib/menu-template-service";
import { buildWorkbook, type MenuIO } from "@/lib/menu-io-service";

/**
 * Download a template's content as Excel (default) or JSON, so an operator
 * can edit it in a spreadsheet and re-upload. Platform-admin only. Template
 * images aren't part of the sheet (they're added in the editor), so the
 * Image column comes out blank.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await getSessionUserId();
  if (!userId || !(await isPlatformAdmin(userId))) {
    return new Response("Not found", { status: 404 });
  }
  const { id } = await params;
  const template = await adminGetTemplate(userId, id);
  if (!template) return new Response("Not found", { status: 404 });

  const menu: MenuIO = {
    categories: template.content.categories.map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({
        name: i.name,
        description: i.description ?? null,
        priceCents: i.priceCents,
        currency: "EUR",
        isAvailable: true,
        spice: i.spice,
        dietary: i.dietary,
        allergens: i.allergens,
        imageFilename: i.imageFilename ?? i.image?.filename ?? null,
      })),
    })),
  };

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "xlsx";
  if (format === "json") {
    return new Response(JSON.stringify(menu, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="template-${template.key}.json"`,
        "cache-control": "no-store",
      },
    });
  }
  const buffer = await buildWorkbook(menu);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="template-${template.key}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
