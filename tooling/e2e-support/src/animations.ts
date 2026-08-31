import type { Page } from "@playwright/test";

/**
 * Settling helpers shared by both frontends' Playwright suites.
 *
 * This package exists because the settle below had been written four times and
 * hardened once. Task 032 fixed the admin copy and left the two portal copies on
 * the original one-frame version (issue #236), which is precisely the failure mode
 * duplication produces: the fix reached the caller that had gone red and not the
 * callers carrying the same latent race. Issue #187 asked for the same thing from
 * the other direction, having watched a mid-transition sample report 1.2:1 contrast
 * in four themes and read like a catastrophic defect.
 *
 * It lives outside both apps because `apps/*` do not import each other. Note that
 * the module is consumed as TypeScript source rather than as a build output: it is
 * only ever loaded by Playwright, which transpiles it the same way it transpiles a
 * spec, so there is nothing here for `turbo run build` to produce.
 */

/** How long any one animation may hold up the settle before it is left behind. */
const MAX_ANIMATION_MS = 1000;

/**
 * Wait until every running transition and animation has finished.
 *
 * Load-bearing before any computed-style read, contrast measurement or axe scan that
 * follows a mode-class swap, and it cost a cycle to find the first time: the vendored
 * controls carry `transition-colors`, so changing the root class starts a colour
 * animation and an immediate sample measures a MID-TRANSITION value - a colour that
 * exists for a tenth of a second and is nobody's experience. Two runs disagreeing on
 * the number is the signature.
 *
 * `document.getAnimations()` asks the exact question ("is anything still animating?"),
 * so this settles as fast as the page does. A `waitForTimeout` would have hidden the
 * same race behind a number that is too small on a loaded machine, and emulating
 * reduced motion would have measured a configuration rather than removing the race:
 * `prefers-reduced-motion: reduce` was tried on issue #187 and did NOT clear the
 * blended readings, because a CSS `transition` on a property that changes still runs
 * unless the transition itself sits behind that media query.
 *
 * TWO FRAMES, AND A LOOP, both earned the hard way.
 *
 * A single `requestAnimationFrame` is not enough. A CSS transition does not exist as an
 * animation until the style change that starts it has been recomputed, and the callback
 * of the first frame can run BEFORE that recalculation - so `getAnimations()` returns an
 * empty list, this resolves immediately, and the sample lands in the middle of a
 * transition that had not started being observable yet. That is a race the caller wins
 * most of the time, which is the worst kind: it surfaced only when an unrelated change on
 * the same page (a preview that now holds state) shifted the render timing by a frame,
 * and it showed up as a `color-contrast` ratio that differed on every run (3.91, then
 * 4.35, against a 4.5 floor) rather than as anything that looked like a timing bug.
 *
 * The loop is for the same reason one layer out: finishing one set of transitions can
 * start another (a dialog that fades in, then its contents settling), so re-asking until
 * the page reports nothing running is the only wait that is actually about the page. The
 * bound exists so an infinite animation cannot hang the suite; it is a safety net, not a
 * timing knob, and hitting it does not fail anything.
 *
 * EACH `finished` IS RACED AGAINST A DEADLINE, and that is the other half of the same
 * safety net (task 034). The round bound above only limits how many times this re-asks; it
 * does nothing about a single `finished` that never settles, and one of those is enough to
 * hang the whole suite forever. It is reachable: a CSS transition on an element that stops
 * being rendered - a mode swap over a page whose modal then hides what it repainted - stays
 * `running` and never resolves. That state was reproduced on the admin's publish screens
 * and cost two 15-minute runs before it was recognised as a wait rather than as a slow
 * page. A transition that has not finished within `MAX_ANIMATION_MS` is one this helper
 * stops waiting for; every real transition in either app is an order of magnitude shorter
 * (`duration-200` is the longest), so the race never fires on a healthy page.
 */
export async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async (maxAnimationMs: number) => {
    // Named rather than inlined into the `new Promise(...)` below: an arrow inside an
    // executor inside a helper inside this callback is five levels of nesting, which
    // `sonarjs/no-nested-functions` rejects.
    const onNextFrame = (resolve: (value: unknown) => void): void => {
      requestAnimationFrame(resolve);
    };
    const frame = async (): Promise<void> => {
      await new Promise(onNextFrame);
    };
    // A deadline for one animation, so a `finished` that never settles is left behind
    // rather than allowed to hang the run.
    const deadline = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, maxAnimationMs));
    };
    const settled = async (animation: Animation): Promise<void> => {
      await Promise.race([animation.finished.catch(() => undefined), deadline()]);
    };
    await frame();
    await frame();
    for (let round = 0; round < 5; round += 1) {
      const running = document.getAnimations();
      if (running.length === 0) return;
      await Promise.all(running.map(settled));
      await frame();
    }
  }, MAX_ANIMATION_MS);
}
