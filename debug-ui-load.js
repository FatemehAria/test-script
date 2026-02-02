// Usage: node debug-ui-load.js [NUM_USERS] => node debug-ui-load.js 50
const { chromium } = require("playwright");
const fs = require("fs");

const APP_URL = process.env.APP_URL || "http://localhost:4200/login";
const NUM_USERS = parseInt(process.argv[2], 10) || 50;
const LAUNCH_HEADLESS = true; // Set to false for visible browsers (headful mode)
const NAV_TIMEOUT = 30000;

(async () => {
  console.log(
    `Starting UI test: Opening ${APP_URL} in ${NUM_USERS} concurrent contexts...`,
  );

  // Launch Playwright browser, fallback to system Chrome if Playwright-managed browsers unavailable
  const launchOptions = { headless: LAUNCH_HEADLESS, args: ["--no-sandbox"] };
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    console.log("Launched Playwright-managed Chromium.");
  } catch (err) {
    console.warn("Playwright-managed browser launch failed:", err.message);
    // list of candidate system installations (Windows)
    const candidatePaths = [
      process.env.CHROME_PATH,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ].filter(Boolean);

    let launched = false;
    for (const exePath of candidatePaths) {
      try {
        console.log("Attempting to launch system Chrome at:", exePath);
        browser = await chromium.launch({
          ...launchOptions,
          executablePath: exePath,
        });
        console.log("Launched system Chrome at", exePath);
        launched = true;
        break;
      } catch (e) {
        console.warn("Failed to launch at", exePath, ":", e.message);
      }
    }

    if (!launched) {
      console.error(
        "No available browser. Either run `npx playwright install` (if CDN allowed) or set CHROME_PATH to a local chrome.exe.",
      );
      process.exit(1);
    }
  }

  // Create contexts and pages
  const contexts = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    contexts.push({ index: i, ctx, page });
  }

  // Navigate to the login page concurrently and measure load times
  const results = await Promise.all(
    contexts.map(async (c) => {
      const { index, page } = c;
      const t0 = Date.now();
      try {
        await page.goto(APP_URL, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT,
        });
        const elapsed = Date.now() - t0;
        return { index, success: true, elapsed };
      } catch (err) {
        return { index, success: false, error: err.message };
      }
    }),
  );
  console.log("All navigations attempted.");

  // Summarize and persist results
  const successes = results.filter((r) => r.success);
  console.log(
    "UI results summary:",
    successes.length,
    "successes out of",
    results.length,
  );

  // Compute simple stats on load times
  const lat = successes.map((r) => r.elapsed).sort((a, b) => a - b);

  function stat(arr) {
    if (!arr.length) return null;
    const sum = arr.reduce((s, v) => s + v, 0);
    return {
      count: arr.length,
      mean: (sum / arr.length).toFixed(1),
      p50: arr[Math.floor(arr.length * 0.5)],
      p95: arr[Math.floor(arr.length * 0.95)],
    };
  }
  console.log("Load time stats (ms):", stat(lat));

  // Save to file
  fs.writeFileSync(
    `ui_results_${Date.now()}.json`,
    JSON.stringify({ results, stats: stat(lat) }, null, 2),
  );

  // If headful, pause for manual interaction (e.g., enter credentials)
  if (!LAUNCH_HEADLESS) {
    console.log(
      "Browsers opened in headful mode. Inspect the pages, enter credentials, and perform tests manually. Press Enter in this terminal to close all browsers and finish.",
    );
    await new Promise((resolve) => process.stdin.once("data", resolve));
  }

  // Cleanup
  for (const c of contexts) await c.ctx.close();
  await browser.close();
  console.log("UI test finished.");
  process.exit(0);
})();
