import { notFound, redirect } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { listCategories } from "@/lib/categories-service";
import { listItems, type ItemRow } from "@/lib/items-service";
import { addItemAction, deleteItemAction, updateItemAction } from "./actions";
import { menuImageUrl } from "@/lib/menu-images";
import { isDrinkCategory } from "@/lib/category-icons";
import { getVenueForUser } from "@/lib/venue-service";

const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

/**
 * Category-detail admin page: lists items in this category and offers a
 * minimal add-item form (name + euro price + allergen check-boxes +
 * availability toggle). Variants, dietary flags, and spice level go through
 * the API for now — the admin form stays intentionally small so the diff is
 * reviewable; richer editing UI is a follow-up.
 */
export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; saved?: string; photo?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const { edit, saved, photo: photoRejected } = await searchParams;
  const base = `/dashboard`;
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // Look up the category by listing them (RLS keeps this tenant-scoped)
  // and finding ours. Cheap enough at N < ~50, and reuses the read a
  // categories page already renders.
  const categoriesResult = await listCategories(userId);
  if (!categoriesResult.ok) {
    if (categoriesResult.error === "no_draft") redirect("/dashboard");
    redirect("/dashboard");
  }
  const category = categoriesResult.value.find((c) => c.id === id);
  if (!category) notFound();

  const itemsResult = await listItems(userId, id);
  const items: ItemRow[] = itemsResult.ok ? itemsResult.value : [];

  // Dietary defaults: kitchens that advertise halal serve halal dishes by
  // default — but a drink is neither halal-marked nor asked about, so the
  // pre-check skips drink-like categories (name heuristic, EN + DE).
  const venueResult = await getVenueForUser(userId);
  const halalOffered = venueResult.ok && venueResult.value.branding.halalFilter === "on";
  const halalDefault = halalOffered && !isDrinkCategory(category.name);

  const addAction = addItemAction.bind(null, id);
  const deleteAction = deleteItemAction.bind(null, id);
  const updateAction = updateItemAction.bind(null, id);

  // datetime-local wants "YYYY-MM-DDTHH:MM" in local time.
  const toLocalInput = (d: Date | null): string => {
    if (!d) return "";
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-brand-cream px-6 py-16 text-brand-green">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-brand-gold">Menu editor</p>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-4xl leading-tight">{category.name}</h1>
        <Link href={`${base}/categories`} className="text-sm underline">
          ← All categories
        </Link>
      </div>
      {photoRejected ? (
        <FlashMessage
          kind="error"
          text={
            photoRejected === "too_large"
              ? "Item saved, but the photo was over 10 MB and was not stored — compress it and upload again."
              : "Item saved, but the photo was not stored — use JPEG, PNG, or WebP (iPhone HEIC photos are not supported; export as JPEG first)."
          }
        />
      ) : saved ? (
        <FlashMessage
          kind="success"
          text="Item saved. Publish the menu to make it live for guests."
        />
      ) : null}

      <form
        action={addAction}
        className="mt-10 space-y-4 border border-brand-green/20 bg-white p-6"
      >
        <h2 className="font-serif text-xl">Add an item</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input
              name="name"
              required
              maxLength={120}
              className="mt-2 block w-full border border-brand-green/20 bg-white px-4 py-3 focus:border-brand-green focus:outline-none"
              placeholder="Wild mushroom risotto"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Price (€)</span>
            <input
              name="priceEuros"
              type="number"
              min={0}
              step={0.01}
              required
              className="mt-2 block w-full border border-brand-green/20 bg-white px-4 py-3 focus:border-brand-green focus:outline-none"
              placeholder="18.00"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Description (optional)</span>
          <textarea
            name="description"
            maxLength={2000}
            rows={2}
            placeholder="Carnaroli rice, black truffle, aged Parmigiano"
            className="mt-2 block w-full border border-brand-green/20 bg-white px-4 py-3 focus:border-brand-green focus:outline-none"
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">Contains</legend>
          <div className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3 md:grid-cols-4">
            {ALLERGENS.map((a) => (
              <label key={a} className="flex items-center gap-2">
                <input type="checkbox" name="allergens" value={a} className="accent-brand-green" />
                <span>{a}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Dietary</legend>
          <div className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3 md:grid-cols-5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="dietary"
                value="vegetarian"
                className="accent-brand-green"
              />
              <span>vegetarian</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="dietary" value="vegan" className="accent-brand-green" />
              <span>vegan</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="dietary"
                value="gluten_free"
                className="accent-brand-green"
              />
              <span>gluten-free</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="dietary"
                value="dairy_free"
                className="accent-brand-green"
              />
              <span>dairy-free</span>
            </label>
            {halalOffered ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="dietary"
                  value="halal"
                  defaultChecked={halalDefault}
                  className="accent-brand-green"
                />
                <span>halal</span>
              </label>
            ) : null}
          </div>
          {halalOffered ? (
            <p className="mt-1.5 text-xs text-brand-green/60">
              {halalDefault
                ? "Halal is pre-checked for dishes — untick it for exceptions."
                : "Drinks aren't halal-marked by default — tick it if it applies."}
            </p>
          ) : null}
        </fieldset>
        <label className="block text-sm">
          <span className="font-medium">Photo (optional)</span>
          <span className="mt-0.5 block text-xs text-brand-green/60">
            JPEG, PNG, or WebP up to 10&nbsp;MB. Without one, guests see one of our styled dish
            pictures.
          </span>
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full text-sm file:mr-3 file:border file:border-brand-green/30 file:bg-brand-cream file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isAvailable" defaultChecked className="accent-brand-green" />
          <span>Available on the menu</span>
        </label>
        <button
          type="submit"
          className="bg-brand-green px-5 py-3 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark"
        >
          Add item
        </button>
      </form>

      <h2 className="mt-14 font-serif text-2xl">Items</h2>
      <ol className="mt-4 divide-y divide-brand-green/10 border border-brand-green/20 bg-white">
        {items.length === 0 ? (
          <li className="p-6 text-sm text-brand-green/60">No items yet. Add one above.</li>
        ) : (
          items.map((item, i) => (
            <li key={item.id} className="flex items-start gap-3 p-4">
              <span className="w-8 font-serif text-sm text-brand-gold">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={menuImageUrl(item.photoKey, item.id, 96)}
                alt=""
                className="h-11 w-11 shrink-0 rounded-sm border border-brand-green/20 object-cover"
              />
              <div className="flex-1">
                <p className="font-medium">
                  {item.name}
                  {item.offerPriceCents ? (
                    <span className="ml-2 rounded-full bg-brand-gold/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-green">
                      Angebot € {(item.offerPriceCents / 100).toFixed(2)}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-brand-green/60">
                  € {(item.priceCents / 100).toFixed(2)}
                  {item.allergens.length > 0 ? ` · ${item.allergens.join(", ")}` : ""}
                  {item.isAvailable ? "" : " · unavailable"}
                </p>
                {edit === item.id ? (
                  <form
                    action={updateAction}
                    className="mt-4 space-y-3 border border-brand-green/20 bg-brand-cream/60 p-4"
                  >
                    <input type="hidden" name="id" value={item.id} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-medium">Name</span>
                        <input
                          name="name"
                          required
                          maxLength={120}
                          defaultValue={item.name}
                          className="mt-1 block w-full border border-brand-green/20 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">Price (€)</span>
                        <input
                          name="priceEuros"
                          type="number"
                          min={0}
                          step={0.01}
                          required
                          defaultValue={(item.priceCents / 100).toFixed(2)}
                          className="mt-1 block w-full border border-brand-green/20 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-xs font-medium">Description</span>
                      <textarea
                        name="description"
                        maxLength={2000}
                        rows={2}
                        defaultValue={item.description ?? ""}
                        className="mt-1 block w-full border border-brand-green/20 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <label className="block">
                        <span className="text-xs font-medium">Angebotspreis (€, optional)</span>
                        <input
                          name="offerEuros"
                          type="number"
                          min={0}
                          step={0.01}
                          defaultValue={
                            item.offerPriceCents ? (item.offerPriceCents / 100).toFixed(2) : ""
                          }
                          placeholder="z. B. 9.90"
                          className="mt-1 block w-full border border-brand-green/20 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">Angebot von (optional)</span>
                        <input
                          name="offerStartsAt"
                          type="datetime-local"
                          defaultValue={toLocalInput(item.offerStartsAt)}
                          className="mt-1 block w-full border border-brand-green/20 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">Angebot bis (optional)</span>
                        <input
                          name="offerEndsAt"
                          type="datetime-local"
                          defaultValue={toLocalInput(item.offerEndsAt)}
                          className="mt-1 block w-full border border-brand-green/20 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <p className="text-[11px] text-brand-green/60">
                      Der Angebotspreis muss unter dem regulären Preis liegen. Leer lassen = kein
                      Angebot. Ohne Datum gilt das Angebot dauerhaft.
                    </p>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="block">
                        <span className="text-xs font-medium">Neues Foto (optional)</span>
                        <input
                          name="photo"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="mt-1 block text-xs"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          name="isAvailable"
                          defaultChecked={item.isAvailable}
                          className="accent-brand-green"
                        />
                        Available
                      </label>
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="bg-brand-green px-4 py-2 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark"
                      >
                        Save item
                      </button>
                      <Link
                        href={`${base}/categories/${category.id}`}
                        className="px-2 py-2 text-xs underline"
                      >
                        Cancel
                      </Link>
                    </div>
                  </form>
                ) : null}
              </div>
              {edit !== item.id ? (
                <Link
                  href={`${base}/categories/${category.id}?edit=${item.id}`}
                  className="border border-brand-green/20 px-3 py-1 text-sm hover:border-brand-green"
                >
                  Edit
                </Link>
              ) : null}
              <form action={deleteAction}>
                <input type="hidden" name="id" value={item.id} />
                <button
                  type="submit"
                  aria-label="Delete item"
                  className="border border-brand-green/20 px-2 py-1 text-sm text-red-700 hover:border-red-700"
                >
                  ✕
                </button>
              </form>
            </li>
          ))
        )}
      </ol>
    </main>
  );
}
