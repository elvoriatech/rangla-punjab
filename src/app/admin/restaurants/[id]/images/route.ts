import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { saveMenuImages } from "@/lib/menu-io-service";

/**
 * Single-photo upload for a restaurant's menu. The client uploader POSTs one
 * file per request (small requests, per-file progress); this stores/resizes
 * one image keyed by filename and returns its outcome. [id] is the tenantId.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await getSessionUserId();
  if (!userId || !(await isPlatformAdmin(userId))) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 404 });
  }
  const { id: tenantId } = await params;
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, error: "nofile" }, { status: 400 });
  }
  const s = await saveMenuImages(tenantId, [file]);
  const outcome = s.failed.length > 0 ? "failed" : s.replaced > 0 ? "replaced" : "saved";
  return Response.json({ ok: true, outcome, filename: file.name });
}
