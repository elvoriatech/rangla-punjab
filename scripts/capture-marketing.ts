import { chromium, type Browser, type Page } from "@playwright/test";

/**
 * Capture REAL product screenshots for the marketing landing page.
 * Runs against the local dev server; writes retina PNGs into
 * public/marketing/. Re-run whenever the product's look changes.
 *
 *   pnpm exec tsx scripts/capture-marketing.ts
 */

const BASE = "http://localhost:3000";
const OUT = "public/marketing";
const ADMIN = { email: "admin@elvoria.local", password: "Elvoria-Admin-2026!" };
const VENUE_ID = "cmrknconx000006sbkqex4h95";
const SLUG = "indisches-restaurant";

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"], input[name="email"]', ADMIN.email);
  await page.fill('input[type="password"], input[name="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/admin|dashboard/, { timeout: 15000 });
}

async function impersonateOwner(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/restaurants/${VENUE_ID}`);
  await page.click('button:has-text("Log in as owner")');
  await page.waitForURL(/restaurant\//, { timeout: 15000 });
}

/** Hide chrome that must not appear in marketing shots: the Next.js
 *  dev-tools badge and the admin impersonation banner. */
async function cleanPage(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal{display:none!important}",
  });
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("div"))) {
      if (el.textContent?.includes("Elvoria support view") && el.children.length < 5) {
        (el.closest("[class*=sticky],[class*=fixed]") ?? el).remove();
        break;
      }
    }
  });
}

async function capture(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
}

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch();

  // ── Guest phone shots (no auth) ──────────────────────────────
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const guest = await phone.newPage();

  await capture("guest-phone", async () => {
    await guest.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await guest.waitForTimeout(4500); // card reveal fail-open
    await cleanPage(guest);
    await guest.screenshot({ path: `${OUT}/product-guest-phone.png` });
  });

  await capture("guest-cart", async () => {
    const add = guest.locator('button:has-text("Add")').first();
    await add.click();
    await guest.waitForTimeout(400);
    await add.click();
    await guest.waitForTimeout(600);
    await guest.locator("button.menu-pop, button.fixed").first().click();
    await guest.waitForTimeout(900);
    await cleanPage(guest);
    await guest.screenshot({ path: `${OUT}/product-guest-cart.png` });
  });
  await phone.close();

  // ── Owner/admin shots (desktop + tablet) ─────────────────────
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await desktop.newPage();
  await loginAdmin(page);

  await capture("templates (admin catalogue)", async () => {
    await page.goto(`${BASE}/admin/templates`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await cleanPage(page);
    await page.screenshot({ path: `${OUT}/product-templates.png` });
  });

  await impersonateOwner(page);

  await capture("dashboard (menu editor)", async () => {
    await page.goto(`${BASE}/restaurant/${SLUG}/categories`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await cleanPage(page);
    await page.screenshot({ path: `${OUT}/product-dashboard.png` });
  });

  await capture("qr page", async () => {
    await page.goto(`${BASE}/restaurant/${SLUG}/qr`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await cleanPage(page);
    await page.screenshot({ path: `${OUT}/product-qr.png` });
  });

  await capture("appearance (themes)", async () => {
    await page.goto(`${BASE}/restaurant/${SLUG}/appearance`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await cleanPage(page);
    await page.screenshot({ path: `${OUT}/product-appearance.png` });
  });

  await capture("delivery areas element", async () => {
    await page.goto(`${BASE}/restaurant/${SLUG}/settings`, { waitUntil: "networkidle" });
    const grid = page.locator('input[name="areaZip_0"]').locator("xpath=ancestor::div[1]");
    await cleanPage(page);
    await grid.screenshot({ path: `${OUT}/product-delivery.png` });
  });

  await capture("opening hours element", async () => {
    const hours = page.locator('input[name="mon_open1"]').locator("xpath=ancestor::div[2]");
    await cleanPage(page);
    await hours.screenshot({ path: `${OUT}/product-hours.png` });
  });

  await desktop.close();

  // Kitchen on a tablet-sized context (same session cookies needed —
  // re-login in a fresh context).
  const tablet = await browser.newContext({
    viewport: { width: 1194, height: 834 },
    deviceScaleFactor: 2,
  });
  const kpage = await tablet.newPage();
  await loginAdmin(kpage);
  await impersonateOwner(kpage);
  await capture("kitchen display", async () => {
    await kpage.goto(`${BASE}/restaurant/${SLUG}/kitchen`, { waitUntil: "networkidle" });
    await kpage.waitForTimeout(1200);
    await cleanPage(kpage);
    await kpage.screenshot({ path: `${OUT}/product-kitchen.png` });
  });
  await tablet.close();

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
