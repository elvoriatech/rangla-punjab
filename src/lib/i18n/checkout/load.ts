import type { UiLocale } from "@/lib/locales";
import type { CheckoutCopy } from "./en";

/**
 * Client-side loader for the checkout catalogue (P7-16).
 *
 * The cart drawer is the one guest surface that needs the WHOLE
 * catalogue, so it cannot be served by prop-passing a handful of strings
 * like the smaller client components are. Instead it asks for one
 * language at a time: the `switch` below is written out literally,
 * because the bundler only emits a chunk per locale when it can see each
 * `import()` specifier statically — `import(`./${locale}`)` would either
 * fail or fold all five back into one chunk.
 *
 * Nothing here imports a catalogue eagerly: `CheckoutCopy` is a
 * type-only import, so no English strings ride along into the caller's
 * chunk.
 */
export async function loadCheckoutCopy(locale: UiLocale): Promise<CheckoutCopy> {
  switch (locale) {
    case "de":
      return (await import("./de")).default;
    case "es":
      return (await import("./es")).default;
    case "it":
      return (await import("./it")).default;
    case "ar":
      return (await import("./ar")).default;
    default:
      return (await import("./en")).default;
  }
}
