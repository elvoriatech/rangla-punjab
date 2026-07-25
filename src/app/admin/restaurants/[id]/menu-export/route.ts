import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { exportMenu, buildWorkbook } from "@/lib/menu-io-service";

/**
 * Operator download of a restaurant's draft menu — Excel (default) or JSON.
 * Platform-admin only; the tenant comes from the route param, so an
 * operator can export any restaurant they administer.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await getSessionUserId();
  if (!userId || !(await isPlatformAdmin(userId))) {
    return new Response("Not found", { status: 404 });
  }
  const { id: tenantId } = await params;

  const menu = await exportMenu(tenantId);
  if (!menu) return new Response("No menu to export yet.", { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "xlsx";
  if (format === "json") {
    return new Response(JSON.stringify(menu, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="menu.json"',
        "cache-control": "no-store",
      },
    });
  }
  const buffer = await buildWorkbook(menu);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="menu.xlsx"',
      "cache-control": "no-store",
    },
  });
}
