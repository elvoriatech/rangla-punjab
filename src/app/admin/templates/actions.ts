"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import {
  adminAddCategory,
  adminAddItem,
  adminCreateTemplate,
  adminDeleteCategory,
  adminDeleteItem,
  adminDeleteTemplate,
  adminReplaceTemplateContentFromMenu,
  adminSetCategoryImage,
  adminSetItemImage,
  savePlatformTemplateImage,
  type TemplateImage,
} from "@/lib/menu-template-service";
import { parseWorkbook, parseJson } from "@/lib/menu-io-service";

async function requireAdmin(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

/** Euro string ("12,50" or "12.50") → integer cents; 0 on garbage. */
function euroToCents(v: FormDataEntryValue | null): number {
  const n = Math.round(parseFloat(String(v ?? "0").replace(",", ".")) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Optional photo field → uploaded TemplateImage, mirroring the owner
 *  forms: an untouched file input (empty File) or a bad image just means
 *  "no photo" — never lose the text work over it. */
async function maybeUploadPhoto(
  userId: string,
  form: FormData,
): Promise<TemplateImage | undefined> {
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return undefined;
  const saved = await savePlatformTemplateImage(userId, photo);
  return saved.ok ? saved.image : undefined;
}

export async function createTemplateAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const result = await adminCreateTemplate(userId, {
    key: String(form.get("key") ?? ""),
    name: String(form.get("name") ?? ""),
    cuisine: String(form.get("cuisine") ?? ""),
    emoji: String(form.get("emoji") ?? "🍽"),
  });
  revalidatePath("/admin/templates", "page");
  if (!result.ok) {
    redirect(`/admin/templates?error=${result.error}`);
  }
  redirect(`/admin/templates/${result.id}`);
}

/** Permanently delete a template (list page, behind a confirm). */
export async function deleteTemplateAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const result = await adminDeleteTemplate(userId, id);
  if (result === "forbidden") redirect("/login");
  revalidatePath("/admin/templates", "page");
  redirect(result === "ok" ? "/admin/templates?saved=deleted" : "/admin/templates?error=notfound");
}

/** Bulk-populate a template from an uploaded .xlsx or .json (text only —
 *  photos are added in the editor). Replaces the template's content. */
export async function importTemplateAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`/admin/templates/${id}?tio=nofile`);

  const buf = Buffer.from(await file.arrayBuffer());
  const isJson = file.name.toLowerCase().endsWith(".json") || file.type.includes("json");
  const parsed = isJson ? parseJson(buf.toString("utf8")) : await parseWorkbook(buf);
  if (parsed.errors.length > 0)
    redirect(`/admin/templates/${id}?tio=err&n=${parsed.errors.length}`);

  const result = await adminReplaceTemplateContentFromMenu(userId, id, parsed.menu);
  if (result === "forbidden") redirect("/login");
  revalidatePath(`/admin/templates/${id}`, "page");
  revalidatePath("/admin/templates", "page");
  const cats = parsed.menu.categories.length;
  const items = parsed.menu.categories.reduce((n, c) => n + c.items.length, 0);
  redirect(
    result === "ok"
      ? `/admin/templates/${id}?tio=ok&c=${cats}&i=${items}&w=${parsed.warnings.length}`
      : `/admin/templates/${id}?tio=invalid`,
  );
}

export async function addCategoryAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const image = await maybeUploadPhoto(userId, form);
  await adminAddCategory(userId, id, String(form.get("name") ?? ""), image);
  revalidatePath("/admin/templates/[id]", "page");
  redirect(`/admin/templates/${id}`);
}

export async function setCategoryImageAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const image = await maybeUploadPhoto(userId, form);
  if (image) {
    await adminSetCategoryImage(userId, id, Number(form.get("categoryIndex")), image);
  }
  revalidatePath("/admin/templates/[id]", "page");
  redirect(`/admin/templates/${id}#cat-${form.get("categoryIndex")}`);
}

export async function setItemImageAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const image = await maybeUploadPhoto(userId, form);
  if (image) {
    await adminSetItemImage(
      userId,
      id,
      Number(form.get("categoryIndex")),
      Number(form.get("itemIndex")),
      image,
    );
  }
  revalidatePath("/admin/templates/[id]", "page");
  redirect(`/admin/templates/${id}#cat-${form.get("categoryIndex")}`);
}

export async function deleteCategoryAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  await adminDeleteCategory(userId, id, Number(form.get("index")));
  revalidatePath("/admin/templates/[id]", "page");
  redirect(`/admin/templates/${id}`);
}

export async function addItemAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const image = await maybeUploadPhoto(userId, form);
  await adminAddItem(userId, id, Number(form.get("categoryIndex")), {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? "").trim() || undefined,
    priceCents: euroToCents(form.get("priceEuros")),
    dietary: form.getAll("dietary").map(String),
    allergens: form.getAll("allergens").map(String),
    spice: Number(form.get("spice") ?? 0),
    image,
  });
  revalidatePath("/admin/templates/[id]", "page");
  redirect(`/admin/templates/${id}#cat-${form.get("categoryIndex")}`);
}

export async function deleteItemAction(form: FormData): Promise<void> {
  const userId = await requireAdmin();
  const id = String(form.get("id") ?? "");
  await adminDeleteItem(
    userId,
    id,
    Number(form.get("categoryIndex")),
    Number(form.get("itemIndex")),
  );
  revalidatePath("/admin/templates/[id]", "page");
  redirect(`/admin/templates/${id}#cat-${form.get("categoryIndex")}`);
}
