/**
 * The Stripe native module, loaded lazily and defensively.
 *
 * Why its own file: a bare `require("@stripe/stripe-react-native")` inside
 * a try/catch is NOT enough. Metro resolves requires statically, so the
 * web bundle followed the import into the package's native specs and the
 * export failed outright. The `.web.ts` sibling gives the web bundler a
 * module with no Stripe import at all; native keeps the real one, still
 * behind try/catch because in Expo Go the module isn't linked and touching
 * it throws. Same posture as `loadGoogle` in `auth.tsx`.
 *
 * Only the three entry points the app uses are typed, by hand against the
 * installed package's own declarations — importing the package for its
 * types would put the static import back.
 */
export type StripeModule = {
  initStripe: (params: { publishableKey: string; urlScheme?: string }) => Promise<void>;
  initPaymentSheet: (params: {
    paymentIntentClientSecret: string;
    merchantDisplayName: string;
    returnURL?: string;
    googlePay?: { merchantCountryCode: string; currencyCode?: string; testEnv?: boolean };
    allowsDelayedPaymentMethods?: boolean;
  }) => Promise<{ error?: { code: string; message: string } }>;
  presentPaymentSheet: () => Promise<{ error?: { code: string; message: string } }>;
};

/** Null means "no native sheet here" — the caller falls back to the
 *  hosted payment page. */
export function loadStripe(): StripeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@stripe/stripe-react-native") as StripeModule;
  } catch {
    return null;
  }
}
