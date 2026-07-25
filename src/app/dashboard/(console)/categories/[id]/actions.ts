"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { createItem, softDeleteItem } from "@/lib/items-service";
import { saveUploadedImage } from "@/lib/media-service";

async function requireUser(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

/**
 * Add-item action for the category-detail admin page. Only the essentials:
 * name, price, and one or more allergen check-boxes. Variants + dietary
 * flags + spice come from the API today; the admin form stays minimal so
 * the diff is reviewable — richer editing UI is a follow-up.
 */
export async function addItemAction(categoryId: string, form: FormData): Promise<void> {
  const userId = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const priceEuros = Number(form.get("priceEuros"));
  const allergens = form.getAll("allergens").map(String);
  const dietary = form.getAll("dietary").map(String);
  const isAvailable = form.get("isAvailable") === "on";
  if (!name || Number.isNaN(priceEuros) || priceEuros < 0) return;

  // Optional dish photo. A rejected upload (wrong type / too big) still
  // creates the item — the public menu falls back to a styled default.
  let photoMediaId: string | undefined;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const saved = await saveUploadedImage(userId, photo, name);
    if (saved.ok) photoMediaId = saved.mediaId;
  }

  await createItem(userId, {
    categoryId,
    name,
    description: description || undefined,
    priceCents: Math.round(priceEuros * 100),
    // The form's allergen + dietary check-boxes are the enum names
    // verbatim; zod in the service validates both sets.
    allergens: allergens as never,
    traces: [],
    dietary: dietary as never,
    spice: 0,
    isAvailable,
    photoMediaId,
    variants: [],
  });
  revalidatePath("/dashboard/categories/[id]", "page");
}

export async function deleteItemAction(categoryId: string, form: FormData): Promise<void> {
  const userId = await requireUser();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  await softDeleteItem(userId, id);
  revalidatePath("/dashboard/categories/[id]", "page");
}
