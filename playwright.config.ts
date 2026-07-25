import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the axe accessibility gate (P1-25). Runs
 * `@axe-core/playwright` against the seeded demo venue's public route
 * and fails on any `serious`/`critical` violation. Chromium only —
 * a11y violations on the DOM are engine-neutral and the extra browsers
 * do not earn the CI minutes.
 *
 * The test starts its own Next.js server via `webServer`; the CI job
 * runs migrations + seed before invoking Playwright.
 */

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "chromium",
      use: { channel: "chromium" },
    },
  ],
  webServer: {
    // `pnpm start` runs the standalone Next build. CI builds first as a
    // separate step so this only has to launch the ready-to-serve output.
    command: "pnpm start",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
