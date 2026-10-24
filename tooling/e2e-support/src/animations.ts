import type { Page } from "@playwright/test";

// Loaded only by Playwright, which transpiles this source the way it transpiles a spec,
// so the package produces no build output.

/** How long any one animation may hold up the settle before it is left behind. */
const MAX_ANIMATION_MS = 1000;

/**
 * Call before any computed-style read, contrast measurement or axe scan that follows a
 * class swap, or the sample lands mid-transition.
 *
 * Both frames are needed: a CSS transition is not an animation until the style change
 * that starts it has been recomputed, and the first frame's callback can run before
 * that. The loop re-asks because finishing one set of transitions can start another.
 * Each `finished` is raced against a deadline because a transition on an element that
 * stops being rendered stays running and never resolves.
 */
export async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async (maxAnimationMs: number) => {
    // Named rather than inlined: `sonarjs/no-nested-functions` rejects the nesting.
    const onNextFrame = (resolve: (value: unknown) => void): void => {
      requestAnimationFrame(resolve);
    };
    const frame = async (): Promise<void> => {
      await new Promise(onNextFrame);
    };
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
