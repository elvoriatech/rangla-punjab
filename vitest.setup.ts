import "dotenv/config";

// Tests must NEVER talk to real Stripe, no matter what keys a developer
// has in .env for manual test-mode checkouts. Stripping the pair here
// forces getStripeProvider() onto the in-memory fake for every suite —
// the same guarantee CI has (where the vars are simply absent).
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.PAYPAL_WEBHOOK_ID;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.MICROSOFT_CLIENT_ID;
delete process.env.MICROSOFT_CLIENT_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;

// `next/font` is a build-time loader — outside Next it is not callable. The
// components that load a font only need a class name back.
import { vi } from "vitest";
vi.mock("next/font/google", () => {
  const font = (): { className: string; variable: string; style: object } => ({
    className: "",
    variable: "",
    style: {},
  });
  return { Luckiest_Guy: font, Geist: font, Cormorant_Garamond: font };
});
