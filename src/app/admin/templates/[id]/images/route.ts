import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { adminAttachTemplateImages } from "@/lib/menu-template-service";

/**
 * Single-photo upload for a template. The client uploader POSTs one file at
 * a time (keeps each request small, gives per-file progress), so this
 * handler attaches exactly one image by filename and returns its outcome.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await getSessionUserId();
  if (!userId || !(await isPlatformAdmin(userId))) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 404 });
  }
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, error: "nofile" }, { status: 400 });
  }
  const result = await adminAttachTemplateImages(userId, id, [file]);
  if (typeof result === "string") {
    return Response.json(
      { ok: false, error: result },
      { status: result === "forbidden" ? 404 : 400 },
    );
  }
  const outcome = result.failed > 0 ? "failed" : result.attached > 0 ? "attached" : "unmatched";
  return Response.json({ ok: true, outcome, filename: file.name });
}
