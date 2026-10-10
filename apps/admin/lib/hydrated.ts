"use client";

import { useSyncExternalStore } from "react";

/** Nothing here ever changes, so the subscription is a noop. */
const subscribeToNothing = () => () => {};
const hydrated = () => true;
const notYetHydrated = () => false;

/**
 * Whether React has attached to this tree yet, as a value a render can branch on
 * (issue #1032, Code Owner ruling 2026-10-10).
 *
 * ## What it is for
 *
 * Disabling a Server Action form's submit control until the page has hydrated. An
 * admin form submitted before the attach posts as a full navigation, and under this
 * app's `Referrer-Policy: no-referrer` (`proxy.ts`) a navigation POST carries
 * `Origin: null`. Next's action handler compares that to the host and throws: a
 * MISSING origin is let through with a warning, but the literal string `null`
 * becomes `originHost = 'null'`, fails the comparison, and - because a
 * pre-hydration post is not a fetch action - reaches `throw` rather than the
 * flight-response path. So the one submission shaped like progressive enhancement
 * is the one the handler refuses, and what the operator gets is Next's error
 * boundary with their unsaved editor state gone. #1032 has the measurement and the
 * three options; this is option 1.
 *
 * Nothing here is a security control. The refusal is Next's CSRF protection working
 * as designed, and the admin requires JavaScript anyway (Code Owner, 2026-09-27;
 * `app/layout.tsx`), so there is no scripting-off population to serve. What this
 * fixes is a bad failure mode in the window between first paint and the attach.
 *
 * ## Why `useSyncExternalStore` and not an effect
 *
 * This is the repository's existing hydration-detection pattern, taken from
 * `packages/ui/src/components/a2ui/text-field/TextField.tsx`, which is in turn the
 * mechanism React Aria's own `useIsSSR` is built on. `useSyncExternalStore` answers
 * from its SERVER snapshot during the server render and during the hydrating render,
 * and from its client snapshot on every render after that, so `false` reaches the
 * served bytes by construction and React itself schedules the re-render that flips
 * it. An effect plus `useState` would get to the same place one commit later and
 * would make the disabled state a convention someone has to remember rather than a
 * property of the render.
 *
 * A component mounted on the client AFTER hydration never renders from the server
 * snapshot, so it reads `true` on its first render - which is right: there is no
 * window for markup that no browser was ever showing.
 *
 * ## Why not the `data-qcms-hydrated` attribute
 *
 * `components/hydration-marker.tsx` and `lib/hydration.ts` carry a DOM attribute for
 * the Playwright suite to wait on, and it is deliberately not readable from a render:
 * it is written by a mount effect on `<html>`, so reading it during render would be
 * reading the DOM React is in the middle of committing. The two signals answer the
 * same question for different consumers and both stay.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, hydrated, notYetHydrated);
}
