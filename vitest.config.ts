import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Load .env so tests get DATABASE_URL (Prisma 7 doesn't auto-load it),
    // then strip real Stripe keys so suites always ride the fake provider.
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // Integration tests hit real Postgres / Redis / MailHog under parallel
    // load — vitest's default 5 s per test is too tight when the sinks are
    // saturated. Raise the ceiling; fast unit tests are unaffected.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  // Mirror the `@/*` path alias from tsconfig.json so tests can import
  // application code the same way route handlers and pages do.
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
