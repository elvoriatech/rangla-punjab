"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import {
  createCategory,
  createSchema,
  deleteCategory,
  reorderCategories,
  setCategoryPhoto,
} from "@/lib/categories-service";
import { publishDraft } from "@/lib/menu-versions-service";
import { saveUploadedImage } from "@/lib/media-service";

/**
 * Server actions used by the admin categories page. Each one:
 *   1. Resolves the user from the session cookie.
 *   2. Delegates to the service.
 *   3. Revalidates the page so the list re-renders with fresh data.
 *
 * No JS required — every action is form-driven; the browser submits, we
 * write, and the page reloads. `revalidatePath` is enough because this
 * route is dynamic (no ISR involved).
 */

const path = "/dashboard/categories";

async function requireUser(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

export async function addCategoryAction(form: FormData): Promise<void> {
  const userId = await requireUser();

  // Optional photo: browsers submit an empty File for an untouched file
  // input, so gate on size > 0. A rejected upload (wrong type / too big)
  // just creates the category without a photo — never lose the text work
  // over the image.
  let photoMediaId: string | undefined;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const saved = await saveUploadedImage(userId, photo, String(form.get("name") ?? ""));
    if (saved.ok) photoMediaId = saved.mediaId;
  }

  const parsed = createSchema.safeParse({ name: form.get("name"), photoMediaId });
  if (!parsed.success) return;
  await createCategory(userId, parsed.data);
  revalidatePath(path, "page");
}

/** Upload (or replace) an existing category's photo. `remove=1` clears it. */
export async function setCategoryPhotoAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const id = String(form.get("id") ?? "");
  if (!id) redirect(`${path}?error=photo`);

  if (form.get("remove") === "1") {
    await setCategoryPhoto(userId, id, null);
    revalidatePath(path);
    redirect(`${path}?saved=photo`);
  }

  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) redirect(`${path}?error=photo`);
  const saved = await saveUploadedImage(userId, photo, `category-${id}`);
  if (!saved.ok) redirect(`${path}?error=photo`);
  const result = await setCategoryPhoto(userId, id, saved.mediaId);
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=photo` : `${path}?error=photo`);
}

export async function deleteCategoryAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  await deleteCategory(userId, id);
  revalidatePath(path, "page");
}

/**
 * Move one category up or down by swapping order-index with its neighbour.
 * The service uses full renumber semantics; we just compute the swapped
 * sequence here so a no-JS click works without needing a diff-aware payload.
 */
export async function moveCategoryAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const id = String(form.get("id") ?? "");
  const direction = String(form.get("direction") ?? "");
  if (!id || (direction !== "up" && direction !== "down")) return;

  // Cheapest correct implementation: read current ordering, splice, reorder.
  const { listCategories } = await import("@/lib/categories-service");
  const list = await listCategories(userId);
  if (!list.ok) return;
  const ids = list.value.map((c) => c.id);
  const idx = ids.indexOf(id);
  if (idx < 0) return;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target]!, ids[idx]!];
  await reorderCategories(userId, { orderedIds: ids });
  revalidatePath(path, "page");
}

/**
 * Publish action for the categories page. Deep-copies the draft into a new
 * published MenuVersion (P1-7 service). Returns silently — the revalidated
 * page reflects the new "Last published" timestamp; errors surface via the
 * form's own error boundary in a later polish task.
 */
export async function publishMenuAction(): Promise<void> {
  const userId = await requireUser();
  await publishDraft(userId);
  // Edge copies of the public menu are stale the moment we publish.
  const { purgeMenuForUser } = await import("@/lib/cdn-purge");
  await purgeMenuForUser(userId);
  revalidatePath(path, "page");
  // The overview page shows the same publish status — keep both fresh,
  // and the layout too: the rail's Publish button reads the same state.
  revalidatePath("/dashboard", "page");
  revalidatePath("/dashboard", "layout");
}

/** Fill the draft menu from a starter template, then land back on the
 *  editor. Replaces the current draft (the picker confirms first). */
export async function applyTemplateAction(form: FormData): Promise<void> {
  const userId = await requireUser();
  const key = String(form.get("templateKey") ?? "");
  const { applyTemplateToDraft } = await import("@/lib/menu-template-service");
  const result = await applyTemplateToDraft(userId, key);
  const { venueAdminBase } = await import("@/lib/venue-service");
  const base = (await venueAdminBase(userId)) ?? "/dashboard";
  revalidatePath("/dashboard/categories", "page");
  revalidatePath("/dashboard", "page");
  redirect(
    result.ok
      ? `${base}/categories?templated=${result.itemsCreated}`
      : `${base}/categories?error=template`,
  );
}
