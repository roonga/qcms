"use client";

/**
 * The portal's "this page has hydrated" signal, which the e2e waits read.
 *
 * It cannot lie: a mount effect runs only on the client and only after React has
 * committed, so the attribute is absent from the served HTML by construction rather
 * than by a rule someone has to remember.
 *
 * It is mounted on every root a spec may wait for, and deliberately not in
 * `portal-shell.tsx` or `native-step.tsx`, which the server paints before the swap to
 * the controlled flow: a marker there would be stamped during the exact window the wait
 * exists to close.
 *
 * The cleanup is unreachable today, since every navigation is a full page load. It is
 * there for the day a root is swapped without one, where a stale claim would make a wait
 * resolve on a page that has not hydrated.
 *
 * The attribute name lives in `lib/hydration.ts` so the e2e wait can import it without
 * importing React.
 */

import { useEffect } from "react";

import { HYDRATED_ATTRIBUTE } from "@/lib/hydration";

export function HydrationMarker(): null {
  useEffect(() => {
    document.documentElement.setAttribute(HYDRATED_ATTRIBUTE, "");
    return () => {
      document.documentElement.removeAttribute(HYDRATED_ATTRIBUTE);
    };
  }, []);
  return null;
}
