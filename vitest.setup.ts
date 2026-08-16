import "dotenv/config";

// Tests must NEVER talk to real Stripe, no matter what keys a developer
// has in .env for manual test-mode checkouts. Stripping the pair here
// forces getStripeProvider() onto the in-memory fake for every suite —
// the same guarantee CI has (where the vars are simply absent).
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.MICROSOFT_CLIENT_ID;
delete process.env.MICROSOFT_CLIENT_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;
