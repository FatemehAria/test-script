// Usage: node debug-ui-load.js [NUM_USERS] => node debug-ui-load.js 50
const { chromium } = require("playwright");
const fs = require("fs");

const APP_URL = process.env.APP_URL || "http://localhost:4200/login";
const NUM_USERS = parseInt(process.argv[2], 10) || 2;
const LAUNCH_HEADLESS = false; // Set to false for visible browsers (headful mode)
const NAV_TIMEOUT = 30000;

const LOGIN_USERNAME_SELECTOR = "#username";
const LOGIN_PASSWORD_SELECTOR = "#password";
const LOGIN_SUBMIT_SELECTOR = "#login-submit";
const DRAFTS_PAGE_LINK_SELECTOR = "a[href='/nameh/pishnevis']"; // Link to "پیش نویس" page
const ADD_DRAFT_BUTTON_SELECTOR = "#start-process-btn"; // "افزودن پیش نویس جدید"
const MODAL_SELECTOR = "#user-task-modal";
const FORM_READY_LOG = "FORM_READY"; // Optional: If your app logs this in console for modal ready

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "ABC";
const AUTH_USERNAME = process.env.AUTH_USERNAME || "1";

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
    const exe = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    browser = await chromium.launch({ ...launchOptions, executablePath: exe });
  }

  // Create contexts and pages
  const contexts = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const consoleMessages = [];
    page.on("console", (msg) =>
      consoleMessages.push({ text: msg.text(), ts: Date.now() }),
    );

    contexts.push({ index: i, ctx, page, consoleMessages });
  }

  // Navigate to the login page concurrently and measure load times
  const results = await Promise.all(
    contexts.map(async (c) => {
      const { index, page, consoleMessages } = c;
      const username = AUTH_USERNAME; // "1", "2", etc.
      const password = AUTH_PASSWORD;

      try {
        // 1. Navigate to login and automate login
        await page.goto(APP_URL, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT,
        });
        await page.fill(LOGIN_USERNAME_SELECTOR, username);
        await page.fill(LOGIN_PASSWORD_SELECTOR, password);
        await page.click(LOGIN_SUBMIT_SELECTOR);
        await page.waitForSelector(DRAFTS_PAGE_LINK_SELECTOR, {
          timeout: 20000,
        }); // Confirm login success

        console.log(`User ${username} logged in and redirected`);

        // 2. Navigate to "پیش نویس" page
        // Go directly to pishnevis page
        await page.goto("http://localhost:4200/nameh/pishnevis", {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT,
        });

        console.log(`User ${username} navigated directly to /nameh/pishnevis`);

        // 4. Wait for the add new draft button to appear
        await page.waitForSelector(ADD_DRAFT_BUTTON_SELECTOR, {
          timeout: 15000,
          state: "visible",
        });

        console.log(`User ${username} sees the start button`);

        // 3. Click "افزودن پیش نویس جدید" and measure to modal
        consoleMessages.length = 0; // Clear logs before click
        const clickT0 = Date.now();
        await page.click(ADD_DRAFT_BUTTON_SELECTOR);

        // Wait for modal: Race between DOM selector and console log
        const waitForLog = new Promise((resolve) => {
          const interval = setInterval(() => {
            for (const m of consoleMessages) {
              if (m.text.includes(FORM_READY_LOG)) {
                clearInterval(interval);
                resolve({ method: "log", ts: m.ts });
                return;
              }
            }
          }, 50);
          setTimeout(() => {
            clearInterval(interval);
            resolve(null);
          }, 25000);
        });

        const waitForModal = page
          .waitForSelector(MODAL_SELECTOR, { timeout: 20000 })
          .then(() => ({ method: "dom", ts: Date.now() }))
          .catch(() => null);

        const res = await Promise.race([waitForLog, waitForModal]);
        if (!res) throw new Error("Timeout waiting for modal");

        const elapsed = res.ts - clickT0;

        const modal = page.locator(MODAL_SELECTOR);
        await page.waitForTimeout(2000);

        // Text fields & textareas (skip hidden)
        const textFields = await modal
          .locator(
            'input[type="text"]:visible, input:not([type]):visible, textarea:visible',
          )
          .all();
        for (const el of textFields) {
          try {
            const key =
              (await el.getAttribute("name")) ||
              (await el.getAttribute("id")) ||
              "";
            let value = Math.floor(Math.random() * 1000000).toString(); // Use numbers to avoid int conversion errors
            if (key.includes("tarikhNameh") || key.includes("mohlatPasokh")) {
              // Jalali date
              const today = new Date();
              const jalaliYear = today.getFullYear() - 621;
              const jalaliMonth = String(today.getMonth() + 1).padStart(2, "0");
              const jalaliDay = String(today.getDate()).padStart(2, "0");
              value = `${jalaliYear}/${jalaliMonth}/${jalaliDay}`;
              await el.click(); // Open picker if any
              await el.fill(value);
              await page.keyboard.press("Enter"); // Close picker
            } else {
              await el.fill(value);
            }
            console.log(`Filled text field ${key} with ${value}`);
          } catch (e) {
            console.log(`Text field fill fail: ${e.message}`);
          }
        }

        // Selects (choicesjs)
        const choicesContainers = await modal.locator(".choices:visible").all();
        for (const container of choicesContainers) {
          try {
            await container.click(); // Open dropdown
            await page.waitForSelector(
              ".choices__list--dropdown .choices__item--selectable",
              { timeout: 10000 },
            );
            await page
              .locator(".choices__list--dropdown .choices__item--selectable")
              .first()
              .click();
            console.log(`Selected first option in choicesjs`);
          } catch (e) {
            console.log(`Choicesjs select fail: ${e.message}`);
          }
        }

        // Submit
        const submitBtn = modal.locator(
          'button[action="submit"], button#nextStepBtn, button:has-text("مرحله بعد"), button:has-text("ثبت"), button:has-text("ارسال"), .formio-submit',
        );
        await submitBtn
          .click({ timeout: 10000 })
          .catch((e) => console.log(`Submit fail: ${e.message}`));
        console.log(`User ${username} submitted form`);

        // Confirm success
        await page
          .waitForSelector(
            "text=موفقیت|پیش‌نویس با موفقیت ذخیره شد.|Task completed|ارسال شد",
            { timeout: 20000 },
          )
          .then(() =>
            console.log(`User ${username} - Form submitted successfully`),
          )
          .catch(() =>
            console.log(`User ${username} - No confirmation detected`),
          );

        return {
          index,
          username,
          success: true,
          clickToModalElapsed: elapsed,
          method: res.method,
        };
      } catch (err) {
        return { index, username, success: false, error: err.message };
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
  const latencies = successes
    .map((r) => r.clickToModalElapsed)
    .sort((a, b) => a - b);

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
  console.log("Click-to-Modal stats (ms):", stat(latencies));

  // Save to file
  fs.writeFileSync(
    `ui_load_results_${Date.now()}.json`,
    JSON.stringify({ results, stats: stat(latencies) }, null, 2),
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
})();
