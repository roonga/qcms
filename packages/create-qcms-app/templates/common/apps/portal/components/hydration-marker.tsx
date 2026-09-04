"use client";

/**
 * The portal's first-class "this page has hydrated" signal (issue #159).
 *
 * WHY THIS EXISTS
 * The e2e hydration wait used to infer hydration from an unrelated fact: it looked
 * up `[data-testid="primary-action"]` and read React's internal `__reactFiber$`
 * property off it. That testid exists for the step's Continue/Submit control, for
 * reasons that have nothing to do with hydration, so the harness was coupled to a
 * renderer detail it does not own. Two consequences, both paid for: the wait would
 * turn into an unconditional 30-second timeout on every entry helper if that testid
 * ever moved, and it could not serve a page with no primary action at all - which
 * is exactly the entry page (`/f/:slug`), whose Start control is a plain
 * `<button type="submit">` inside a native form.
 *
 * So the page answers the question itself instead of the harness guessing. This
 * component renders nothing and, in a mount effect, stamps `data-qcms-hydrated` on
 * the document element.
 *
 * WHY IT CANNOT LIE
 * A mount effect runs only on the client and only after React has committed the
 * tree it belongs to. It never runs during a server render, so the attribute is
 * absent from the served HTML by construction - not by a rule someone has to
 * remember. `e2e/hydration-wait.pw.ts` pins both halves against the real server:
 * the attribute is not in the SSR bytes, and it never appears on a page whose
 * bundle was starved.
 *
 * WHERE IT IS MOUNTED, AND THE ONE PLACE IT DELIBERATELY IS NOT
 * Every root a spec may need to wait for renders one: `entry-view.tsx`,
 * `completion-view.tsx`, `message-screen.tsx`, and `step-flow.tsx`.
 *
 * It is NOT in `portal-shell.tsx`, even though that is the one component all four
 * share, and it is NOT in `native-step.tsx`. Both omissions are the same decision.
 * The flow page paints `NativeStep` on the server, renders it again as the first
 * client render so hydration matches, and only then swaps to the controlled
 * `StepFlow` (see `progressive-step.tsx`). A marker inside `PortalShell` would
 * therefore be stamped by `NativeStep` - during the exact window the wait exists to
 * close, when a click still lands on a native control React is about to unmount and
 * no answer is ever posted. Mounting it in `StepFlow` instead means the attribute
 * appears only once the swap has committed, which is the guarantee entry helpers
 * actually need.
 *
 * The cleanup removes the attribute on unmount. As the portal is built today that
 * branch never runs: every navigation is a full page load (`step-flow.tsx` moves
 * between screens with `window.location.assign`, and Start and the no-JS path are
 * native form POSTs), so a document that stamped the marker is discarded rather
 * than re-rendered. It is there for the day a root is swapped without a page load,
 * where leaving a stale claim behind would be the failure that matters - a wait
 * that resolves instantly on a page which has not hydrated is worse than no wait.
 * Ordering is safe if that day comes: React runs a deleted subtree's destroy
 * effects before the replacing tree's create effects, so the attribute is removed
 * and re-added rather than the reverse.
 *
 * Stamping the document element rather than a wrapper element keeps the signal at
 * one selector regardless of which root set it, and it is already how this app
 * talks to `<html>`: the pre-paint mode bootstrap swaps root classes, and
 * `app/layout.tsx` carries `suppressHydrationWarning` for its own reasons. React
 * does not reconcile an attribute it never rendered, so this does not race the
 * layout's own props.
 */

import { useEffect } from "react";

import { HYDRATED_ATTRIBUTE } from "@/lib/hydration";

/**
 * Stamp `data-qcms-hydrated` on `<html>` for as long as this root is mounted.
 *
 * The attribute name lives in `lib/hydration.ts` rather than here, so the e2e wait
 * can import the same constant without importing React.
 */
export function HydrationMarker(): null {
  useEffect(() => {
    document.documentElement.setAttribute(HYDRATED_ATTRIBUTE, "");
    return () => {
      document.documentElement.removeAttribute(HYDRATED_ATTRIBUTE);
    };
  }, []);
  return null;
}
