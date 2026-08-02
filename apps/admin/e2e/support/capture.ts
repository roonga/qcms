import type { Page } from "@playwright/test";

/**
 * Shared machinery for the human design gates' screenshot captures (task 032,
 * extracted from 031's `gate-screenshots.pw.ts` per issue #220).
 *
 * Both capture specs write PNGs into a committed directory, so both are skipped
 * unless `QCMS_ADMIN_CAPTURE_GATE=1` and both drive the real screens through the e2e
 * harness rather than a mock: a gate is only worth something if it shows what an
 * operator would see. Everything that is not the screen list lives here, so the two
 * cannot drift on hydration handling, dev-chrome suppression or viewport sizes.
 *
 * ## Issue #220's "hydration mismatch on a frozen version" is PLAYWRIGHT'S CARET
 *
 * Recorded here because it cost two rounds of a human gate and the diagnosis is not
 * guessable from the symptom. The reported failure was a React hydration mismatch
 * whose diff pointed at a disabled react-aria `NumberField`:
 *
 *     -  style={{caret-color:"transparent"}}
 *     +  style={undefined}
 *
 * which reads exactly like an upstream SSR/CSR difference, and was filed as one. It
 * is not. `caret-color: transparent` appears nowhere in react-aria-components and
 * nowhere in this app; the only source of it in the whole tree is Playwright itself.
 * `page.screenshot()` defaults to `caret: "hide"`, which suppresses the text caret by
 * writing that style into the document before capturing and undoing it afterwards.
 * When the next hard navigation starts before that undo has landed, the NEW
 * document's server HTML carries a style the client tree does not, and React reports
 * the difference against whichever element happened to be under it - which is why the
 * blamed component moved between runs and why nothing about the app explained it.
 *
 * Three things follow, and all three are load-bearing. `caret: "initial"` below is
 * the fix (proven: the same 18-frame capture fails every run with the default and
 * passes every run without it). `apps/admin/e2e/questions-lifecycle.pw.ts` never
 * failed on the same screens because it takes no screenshots, which is the "two specs
 * doing the same navigation disagree" puzzle #220 could not close. And the earlier
 * suspicion that `hideDevChrome` was racing hydration was wrong: the stylesheet
 * rewrite below is still right on its own merits, but it did not change this symptom
 * at all.
 */

/** 390px and 1280px, per the Code Owner's 2026-07-25 rule. */
export const CAPTURE_WIDTHS = [390, 1280] as const;

/** The sheet's three mode layers, in the vocabulary the `qcms-app-mode` cookie uses. */
export const CAPTURE_MODES = ["light", "dark", "hc"] as const;

/** Runs only with the flag: it dirties a committed directory. */
export const CAPTURE_ENABLED = process.env.QCMS_ADMIN_CAPTURE_GATE === "1";

/**
 * Wait until React has finished hydrating before touching the DOM.
 *
 * React tags every host node it owns with a `__reactFiber$...` property when it
 * hydrates, so the presence of one is the attachment signal itself rather than a
 * proxy for it. Every screen captured here renders at least one `<button>`, so that
 * is the probe.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector("button");
    if (button === null) return false;
    return Object.keys(button).some((key) => key.startsWith("__reactFiber$"));
  });
}

/**
 * Hide the Next dev-tools indicator with a stylesheet, never by removing its node.
 *
 * This is the fix issue #220 asks for, and the reason matters. 031's version removed
 * `nextjs-portal`, which is a React-owned element, and doing that while hydration was
 * still in flight desynchronized React's hydration walk - it reported a mismatch on an
 * unrelated input (`style={{caret-color:"transparent"}}` against `style={undefined}`)
 * that the shared console gate then correctly failed the run on. A rule that sets
 * `display: none` changes no tree at all, so the race cannot exist rather than being
 * timed around, and it keeps working if Next renames or re-mounts the overlay later.
 *
 * Every selector is expected to match nothing in a production build: this chrome only
 * exists under `next dev`. The style element is added once per document and marked,
 * so repeated calls across viewport changes do not stack up copies.
 */
const DEV_CHROME_CSS =
  "nextjs-portal,#__next-build-watcher,[data-nextjs-toast]{display:none !important}";

export async function hideDevChrome(page: Page): Promise<void> {
  await page.evaluate((css) => {
    const id = "qcms-gate-hide-dev-chrome";
    if (document.getElementById(id) !== null) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.append(style);
  }, DEV_CHROME_CSS);
}

/**
 * Refuse to shoot a frame whose document is wider than the viewport it claims to be.
 *
 * `page.screenshot({ fullPage: true })` sizes the PNG to the document, not the viewport, so
 * a screen that overflows horizontally produces a file that is silently wider than the
 * width in its own filename. That is worse than a plain bug: the gate's whole job is to be
 * evidence, and a `*-390.png` that is 434 wide misdescribes itself to a reviewer who has no
 * way to check a PNG's pixel width in a GitHub diff. PR #245 shipped six such frames and
 * they were signed off before anyone measured them.
 *
 * It is also an accessibility check the automated sweep cannot make. Horizontal overflow at
 * a phone width is WCAG 2.2 AA SC 1.4.10 Reflow, and axe-core does not test 1.4.10, so an
 * all-green axe run says nothing either way. Failing here is the only place it gets caught.
 */
async function assertFitsViewport(page: Page, width: number, name: string): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > width) {
    throw new Error(
      `Capture "${name}" overflows its ${String(width)}px viewport: the document is ` +
        `${String(scrollWidth)}px wide, so the full-page PNG would be ${String(scrollWidth)}px ` +
        `and not the ${String(width)}px its filename claims. This is WCAG 2.2 AA SC 1.4.10 ` +
        `Reflow, which axe does not test. Fix the layout (a long unbreakable token usually ` +
        `wants overflow-wrap) rather than the capture.`,
    );
  }
}

/**
 * A capture function bound to one output directory.
 *
 * Order is deliberate: hydrate, then suppress the dev chrome, then resize and shoot.
 * The suppression is a stylesheet, so it survives every viewport change and is applied
 * exactly once no matter how many widths follow.
 *
 * The page is left at the wide viewport so the next navigation starts from a known
 * shape rather than from whatever the last width happened to be.
 */
export function captureInto(outDir: string): (page: Page, name: string) => Promise<void> {
  return async (page, name) => {
    await waitForHydration(page);
    await hideDevChrome(page);
    for (const width of CAPTURE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      // Back to the top before every frame. The topbar is `position: sticky`, and a
      // full-page capture of a SCROLLED page paints it at its scroll offset, so a
      // screen the test had to scroll (clicking "Add option" scrolls the list into
      // view) came out with the bar floating in the middle of the frame under a blank
      // band. The bar is what this gate reviews, so that is not a cosmetic problem.
      await page.evaluate(() => {
        globalThis.scrollTo(0, 0);
        // And every horizontally-scrolled container back to its start. The operations
        // tables are `overflow-x: auto`, so clicking a control in their right-hand
        // column scrolls the container to bring it into view - and a full-page shot
        // then paints the table at that offset, with its first column clipped off the
        // left edge. Three of 035's delivery-detail frames shipped that way: the
        // content was correct and the frame looked broken, which is the worst failure
        // mode for evidence. Same reasoning as the window reset above, one axis over.
        for (const box of document.querySelectorAll("*")) {
          if (box.scrollLeft !== 0) box.scrollLeft = 0;
        }
      });
      await assertFitsViewport(page, width, `${name}-${width}`);
      await page.screenshot({
        path: `${outDir}/${name}-${width}.png`,
        fullPage: true,
        caret: "initial",
      });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  };
}
