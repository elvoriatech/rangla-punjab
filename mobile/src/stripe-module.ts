import type React from "react";
import type { StyleProp, ViewStyle } from "react-native";

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
 * Only the entry points the app uses are typed, by hand against the
 * installed package's own declarations — importing the package for its
 * types would put the static import back. `PlatformPayButton` is in here
 * for the same reason: the component is REACHED through this seam rather
 * than imported, so the web bundle still has no Stripe in it (P7-13).
 */

/** One line of the Apple Pay sheet. `paymentType` mirrors the package's
 *  `PlatformPay.PaymentType` enum, whose values are these strings. */
export interface CartSummaryItem {
  paymentType: "Immediate";
  label: string;
  /** Major units as a decimal string, e.g. "24.90". */
  amount: string;
}

export interface PlatformPayConfirmParams {
  applePay?: {
    merchantCountryCode: string;
    currencyCode: string;
    cartItems: CartSummaryItem[];
  };
  googlePay?: {
    testEnv: boolean;
    merchantCountryCode: string;
    currencyCode: string;
    merchantName?: string;
  };
}

export interface PlatformPayButtonProps {
  onPress: () => void;
  disabled?: boolean;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export type StripeModule = {
  initStripe: (params: {
    publishableKey: string;
    urlScheme?: string;
    /** iOS only, and only when APPLE_MERCHANT_ID is configured (⛔) —
     *  without it Apple Pay cannot be presented at all. */
    merchantIdentifier?: string;
  }) => Promise<void>;
  initPaymentSheet: (params: {
    paymentIntentClientSecret: string;
    merchantDisplayName: string;
    returnURL?: string;
    applePay?: { merchantCountryCode: string };
    googlePay?: { merchantCountryCode: string; currencyCode?: string; testEnv?: boolean };
    allowsDelayedPaymentMethods?: boolean;
  }) => Promise<{ error?: { code: string; message: string } }>;
  presentPaymentSheet: () => Promise<{ error?: { code: string; message: string } }>;
  /** Apple Pay on iOS, Google Pay on Android. On Android this needs the
   *  SDK to have been initialised, so it can legitimately answer false
   *  (or throw) before the first `initStripe` — the caller treats both as
   *  "no wallet button". */
  isPlatformPaySupported: (params?: { googlePay?: { testEnv?: boolean } }) => Promise<boolean>;
  confirmPlatformPayPayment: (
    clientSecret: string,
    params: PlatformPayConfirmParams,
  ) => Promise<{ error?: { code: string; message: string } }>;
  PlatformPayButton: React.ComponentType<PlatformPayButtonProps>;
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
