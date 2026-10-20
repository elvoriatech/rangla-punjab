import type { MenuCopy } from "@/lib/i18n/menu";
import type { DeliveryArea } from "@/lib/ordering-config";

/**
 * "About us" — a short block above the footer saying who the restaurant
 * is, where, and how to order (owner, 2026-10-19). It exists for local
 * search: a search engine matches "indisches Restaurant Konstanz" against
 * sentences on the page, and the menu alone is a list of dish names.
 *
 * Every sentence is assembled from settings the owner already made — the
 * name, the delivery areas, the reservation switch, the address — so the
 * block can never claim something untrue, and it updates itself when a
 * setting changes. Server-rendered, no script.
 */

/** "Rangla Punjab Restaurant · Konstanz" → name "Rangla Punjab Restaurant",
 *  city "Konstanz". A name without the separator is all name. */
export function splitVenueName(full: string): { name: string; cityFromName: string | null } {
  const [name, ...rest] = full.split("·").map((p) => p.trim());
  const city = rest.join(" ").trim();
  return { name: name || full.trim(), cityFromName: city || null };
}

/** The town of a "Street 1\n78462 Konstanz" address, if the last line has one. */
export function townFromAddress(address: string | null | undefined): string | null {
  const last = (address ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  const m = last ? /^\d{4,5}\s+(.+)$/.exec(last) : null;
  return m ? m[1]!.trim() : null;
}

/** "Konstanz (78462, 78464, 78465)" — delivery areas grouped by town. */
export function deliveryPlaces(areas: readonly DeliveryArea[]): string | null {
  if (areas.length === 0) return null;
  const byTown = new Map<string, string[]>();
  for (const a of areas) {
    const town = a.locality.trim();
    byTown.set(town, [...(byTown.get(town) ?? []), a.zip]);
  }
  return [...byTown.entries()]
    .map(([town, zips]) => (town ? `${town} (${zips.join(", ")})` : zips.join(", ")))
    .join(", ");
}

export function AboutSection({
  t,
  venueName,
  postalAddress,
  cuisine,
  dishes,
  takeaway,
  delivery,
  deliveryAreas,
  reservations,
}: {
  t: MenuCopy;
  venueName: string;
  postalAddress: string | null;
  /** Mid-sentence cuisine ("indische und pakistanische Küche"). */
  cuisine: string;
  dishes: readonly string[];
  takeaway: boolean;
  delivery: boolean;
  deliveryAreas: readonly DeliveryArea[];
  reservations: boolean;
}): React.ReactElement {
  const { name, cityFromName } = splitVenueName(venueName);
  const city =
    townFromAddress(postalAddress) ??
    cityFromName ??
    (deliveryAreas.find((a) => a.locality.trim())?.locality.trim() || null);
  const places = delivery ? deliveryPlaces(deliveryAreas) : null;
  const orderLine =
    takeaway && delivery
      ? t.about.orderBoth
      : takeaway
        ? t.about.orderPickup
        : delivery
          ? t.about.orderDelivery
          : null;
  const address = postalAddress
    ? postalAddress
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <section
      aria-label={t.about.aria}
      className="mx-auto w-full max-w-3xl px-4 pb-14 pt-4 text-center sm:px-6"
    >
      <h2 className="font-serif text-2xl leading-tight text-[var(--menu-heading,var(--menu-accent))] sm:text-3xl">
        {t.about.heading(name, city)}
      </h2>
      <div className="mt-4 space-y-2 text-sm leading-relaxed text-[var(--menu-text)]/85 sm:text-base">
        <p>{t.about.intro(name, cuisine, city, dishes.join(", "))}</p>
        {orderLine || places ? (
          <p>
            {orderLine}
            {orderLine && places ? " " : null}
            {places ? t.about.deliversTo(places) : null}
          </p>
        ) : null}
        {reservations ? <p>{t.about.reserve}</p> : null}
        {address ? <p>{t.about.address(address)}</p> : null}
      </div>
    </section>
  );
}
