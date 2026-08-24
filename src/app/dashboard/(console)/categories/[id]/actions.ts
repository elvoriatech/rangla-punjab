"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { createItem, softDeleteItem, updateItem } from "@/lib/items-service";
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
  // creates the item — but the rejection is SURFACED via ?photo=<reason>
  // so the owner knows the image didn't make it.
  let photoMediaId: string | undefined;
  let photoError: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const saved = await saveUploadedImage(userId, photo, name);
    if (saved.ok) photoMediaId = saved.mediaId;
    else photoError = saved.error;
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
  if (photoError) redirect(`/dashboard/categories/${categoryId}?saved=1&photo=${photoError}`);
}

/**
 * Edit an existing item — name, description, price, availability, photo,
 * and the offer ("Angebot"): a reduced price with an optional date window.
 * An offer at or above the regular price is refused here AND by the DB
 * CHECK — a struck-through "was" price must always be a real reduction.
 */
export async function updateItemAction(categoryId: string, form: FormData): Promise<void> {
  const userId = await requireUser();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const priceEuros = Number(form.get("priceEuros"));
  const isAvailable = form.get("isAvailable") === "on";
  if (!id || !name || Number.isNaN(priceEuros) || priceEuros < 0) return;
  const priceCents = Math.round(priceEuros * 100);

  const offerRaw = String(form.get("offerEuros") ?? "").trim();
  const offerCents = offerRaw ? Math.round(Number(offerRaw) * 100) : null;
  const validOffer = offerCents !== null && offerCents > 0 && offerCents < priceCents;
  const parseLocal = (v: string): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const offerStartsAt = validOffer ? parseLocal(String(form.get("offerStartsAt") ?? "")) : null;
  const offerEndsAt = validOffer ? parseLocal(String(form.get("offerEndsAt") ?? "")) : null;

  let photoMediaId: string | undefined;
  let photoError: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const saved = await saveUploadedImage(userId, photo, name);
    if (saved.ok) photoMediaId = saved.mediaId;
    else photoError = saved.error;
  }

  await updateItem(userId, id, {
    name,
    description: description || undefined,
    priceCents,
    isAvailable,
    ...(photoMediaId ? { photoMediaId } : {}),
    offerPriceCents: validOffer ? offerCents : null,
    offerStartsAt,
    offerEndsAt,
  });
  revalidatePath("/dashboard/categories/[id]", "page");
  redirect(
    `/dashboard/categories/${categoryId}?saved=1${photoError ? `&photo=${photoError}` : ""}`,
  );
}

export async function deleteItemAction(categoryId: string, form: FormData): Promise<void> {
  const userId = await requireUser();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  await softDeleteItem(userId, id);
  revalidatePath("/dashboard/categories/[id]", "page");
}
