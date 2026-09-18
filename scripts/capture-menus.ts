import { execSync } from "node:child_process";
import { chromium } from "@playwright/test";

/**
 * Capture the REAL guest menu across device sizes and themes for the
 * marketing page. Switches the demo venue's theme between phone
 * captures (restored to mughal-night at the end).
 *
 *   pnpm exec tsx scripts/capture-menus.ts
 */

const BASE = "http://localhost:3000";
const OUT = "public/marketing";
const SLUG = "indisches-restaurant";
const ORIGINAL_THEME = "mughal-night";
const GALLERY_THEMES = ["ivory-day", "fresh-bistro", "royal-sapphire", "burger-bold"];

function setTheme(theme: string): void {
  const container = execSync("docker ps -qf name=postgres").toString().trim().split("\n")[0];
  execSync(
    `docker exec -i ${container} psql -U elvoria -d elvoria -q -c "UPDATE venues SET branding = branding || '{\\"theme\\":\\"${theme}\\"}' WHERE slug='${SLUG}';"`,
  );
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const clean = "nextjs-portal{display:none!important}";

  const shoot = async (
    viewport: { width: number; height: number },
    path: string,
    isMobile = false,
  ): Promise<void> => {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      isMobile,
      hasTouch: isMobile,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?x=${Date.now()}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4500);
    await page.addStyleTag({ content: clean });
    await page.screenshot({ path });
    await ctx.close();
    console.log(`✓ ${path}`);
  };

  // Current theme at desktop + tablet sizes.
  await shoot({ width: 1440, height: 900 }, `${OUT}/product-menu-desktop.png`);
  await shoot({ width: 1024, height: 768 }, `${OUT}/product-menu-tablet.png`);

  // Theme gallery on phones.
  for (const theme of GALLERY_THEMES) {
    setTheme(theme);
    await shoot({ width: 390, height: 844 }, `${OUT}/product-menu-${theme}.png`, true);
  }
  setTheme(ORIGINAL_THEME);
  console.log(`theme restored to ${ORIGINAL_THEME}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
