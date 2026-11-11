/**
 * Optional Playwright helper to obtain a reCAPTCHA v3 token from SIGA.
 * Only runs when `IMPI_USE_PLAYWRIGHT=1` and Playwright browsers are installed.
 * Not supported on Vercel serverless — use a local/worker host.
 */

import { SIGA_ORIGIN, SIGA_RECAPTCHA_SITE_KEY } from "@/lib/fetcher/siga-tugaceta";

export async function fetchRecaptchaTokenWithPlaywright(
  action = "inicioPage",
): Promise<string> {
  // Dynamic require so Next/Vercel builds don't hard-depend on playwright.
  // Use createRequire + variable name to avoid bundler resolve-time failures.
  let playwright: typeof import("playwright");
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require("node:module") as typeof import("node:module");
    const req = createRequire(__filename);
    const modName = ["play", "wright"].join("");
    playwright = req(modName) as typeof import("playwright");
  } catch {
    throw new Error(
      "Playwright no instalado. Ejecuta: npm i -D playwright && npx playwright install chromium",
    );
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(SIGA_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // Wait for grecaptcha to be ready (SPA loads api.js?render=...)
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { grecaptcha?: { ready: (cb: () => void) => void; execute: Function } }).grecaptcha
          ?.execute === "function",
      { timeout: 30_000 },
    );

    const token = await page.evaluate(
      async (arg: unknown) => {
        const { siteKey, actionName } = arg as {
          siteKey: string;
          actionName: string;
        };
        const g = (
          window as unknown as {
            grecaptcha: {
              ready: (cb: () => void) => void;
              execute: (key: string, opts: { action: string }) => Promise<string>;
            };
          }
        ).grecaptcha;
        await new Promise<void>((resolve) => g.ready(() => resolve()));
        return g.execute(siteKey, { action: actionName });
      },
      { siteKey: SIGA_RECAPTCHA_SITE_KEY, actionName: action },
    );

    if (!token || typeof token !== "string" || token.length < 20) {
      throw new Error("Playwright no obtuvo token reCAPTCHA usable");
    }
    return token;
  } finally {
    await browser.close();
  }
}
