/**
 * Lighthouse accessibility gate (task 030, exit criterion 1): a11y category = 100
 * on the page-load states a fresh navigation can reach - entry, the flow page
 * (session cookie injected), an error message screen, and completion. This is the
 * CI-enforced Lighthouse half; the interactive-only states (post-branch-change,
 * blocked-submit summary) are covered by the axe spec, which runs inside the real
 * cookie-bearing Playwright context.
 *
 * Lighthouse runs its OWN headless Chrome (reusing Playwright's bundled Chromium
 * binary via chrome-launcher), so cookies from the Playwright browser context are
 * not shared. For the cookie-gated flow page we therefore drive a session with
 * Playwright, read the httpOnly session cookie, and hand it to Lighthouse as a
 * request `Cookie` header (`extraHeaders`) so its fresh Chrome renders the real
 * authenticated flow instead of the recovery screen. See `docs/a11y.md`.
 */

import { chromium } from "@playwright/test";

import { expect, test } from "./support/gates.js";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

import { userDataDirFlag, withChromeProfile } from "./support/chrome-profile.js";
import { PORTAL_PORT } from "./support/harness-config.js";
import { readFixtures } from "./support/fixtures.js";
import { startAnonymousFlow } from "./support/flow.js";
import { startKitchenSink } from "./support/kitchen-sink.js";

const BASE = `http://localhost:${PORTAL_PORT}`;
const SESSION_COOKIE = "qcms_session";

// One Lighthouse run (launch Chrome, audit, kill) is ~10-20s; give each test room
// on top of the launch, and run this suite serially (one Chrome at a time).
test.describe.configure({ mode: "serial", timeout: 120_000 });

/**
 * Run a Lighthouse accessibility-only audit of `url` and return the 0..1 score.
 * `cookie`, when given, is sent as a request header so a cookie-gated page renders
 * authenticated in Lighthouse's own Chrome.
 */
async function accessibilityScore(url: string, cookie?: string): Promise<number> {
  // The profile directory is chosen here rather than by chrome-launcher (issue #248):
  // on WSL its default writes a literal `C:\Users\...` directory into the repository
  // root, five per run, never cleaned up. `userDataDir` stops it creating one, the
  // repeated flag in `chromeFlags` overrides the `wslpath`-converted spelling
  // chrome-launcher passes to the browser, and `withChromeProfile` owns the removal
  // that the option disables. The whole mechanism is in `support/chrome-profile.ts`.
  return withChromeProfile(async (userDataDir) => {
    const chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        userDataDirFlag(userDataDir),
      ],
      userDataDir,
    });
    try {
      const runnerResult = await lighthouse(url, {
        port: chrome.port,
        onlyCategories: ["accessibility"],
        output: "json",
        logLevel: "error",
        ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
      });
      const score = runnerResult?.lhr.categories.accessibility?.score;
      return typeof score === "number" ? score : 0;
    } finally {
      // On Windows, chrome-launcher's temp-profile cleanup can throw EPERM because
      // the just-killed Chrome has not released its profile files yet. The audit is
      // already complete, so this teardown race must not fail the test. `kill()` is
      // synchronous (chrome-launcher returns void), so a throw is caught directly.
      try {
        chrome.kill();
      } catch {
        /* best-effort: leaked temp profile is cleaned by the OS */
      }
    }
  });
}

test("lighthouse a11y=100: entry page", async () => {
  const { slug } = readFixtures();
  const score = await accessibilityScore(`${BASE}/f/${slug}`);
  expect(score).toBe(1);
});

test("lighthouse a11y=100: flow page (authenticated via injected session cookie)", async ({
  page,
  context,
}) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  const flowUrl = page.url();

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session, "session cookie should be set after starting the flow").toBeTruthy();

  const score = await accessibilityScore(flowUrl, `${SESSION_COOKIE}=${session?.value ?? ""}`);
  expect(score).toBe(1);
});

test("lighthouse a11y=100: kitchen-sink flow page (authenticated via injected session cookie)", async ({
  page,
  context,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  const flowUrl = page.url();

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session, "session cookie should be set after starting the flow").toBeTruthy();

  const score = await accessibilityScore(flowUrl, `${SESSION_COOKIE}=${session?.value ?? ""}`);
  expect(score).toBe(1);
});

test("lighthouse a11y=100: error message screen", async () => {
  const score = await accessibilityScore(`${BASE}/expired`);
  expect(score).toBe(1);
});

test("lighthouse a11y=100: completion page", async () => {
  const score = await accessibilityScore(`${BASE}/done`);
  expect(score).toBe(1);
});
