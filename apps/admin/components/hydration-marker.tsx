"use client";

import { useEffect } from "react";

import { HYDRATED_ATTRIBUTE } from "@/lib/hydration";

/**
 * The admin's first-class "this page has hydrated" signal (issue #210).
 *
 * ## The defect it exists for
 *
 * The admin's auth screens server-render a complete, fillable `<form method="post">`, and
 * React attaches to it 76-404ms later (measured on an idle machine; longer under load).
 * The vendored `TextField` hands react-aria neither `value` nor `defaultValue`, so
 * react-aria renders a CONTROLLED input whose state starts empty - and the moment React
 * attaches it writes that empty state onto the input, discarding anything typed into the
 * server-rendered markup in the meantime. On the two-factor challenge the consequence is
 * silent and total: the `code` field is `required`, so the submit that follows is stopped
 * by the browser's own constraint validation. No submit event fires, no request is made,
 * no error is shown, and the screen simply stays where it was.
 *
 * That was issue #210's flake, reproduced 12 times in 20 attempts with the wipe timestamp
 * equal to React's attach timestamp. It is load-correlated because load widens the window,
 * not because anything about it is random.
 *
 * ## What this fixes, and what it does not
 *
 * It gives the harness a truthful moment to wait for, which is what removes the race from
 * the specs. It does NOT make a pre-hydration keystroke survive: that lives in the vendored
 * react-aria `TextField`, which ADR-22 freezes byte-for-byte against upstream, so it is an
 * upstream change and a pin move rather than something to patch here. The operator-facing
 * half of the defect is recorded on the issue.
 *
 * ## Why it cannot lie
 *
 * A mount effect runs only on the client, and only after React has committed the tree it
 * belongs to. It never runs during a server render, so the attribute is absent from the
 * served bytes by construction rather than by a convention someone has to keep.
 * `e2e/hydration-wait.pw.ts` pins both halves against the real server.
 *
 * ## Where it is mounted
 *
 * Once, in `app/layout.tsx`, which is the single root every admin page shares. That is a
 * stronger position here than it would be in the portal, whose flow page deliberately
 * swaps a native fallback for a controlled render and therefore needs the marker on the
 * controlled root instead. The admin performs no such swap and declares no Suspense
 * boundary anywhere under `app/`, so its pages hydrate in one commit and a root-level
 * effect fires after all of it, the interactive controls included.
 */
export function HydrationMarker(): null {
  useEffect(() => {
    document.documentElement.setAttribute(HYDRATED_ATTRIBUTE, "");
    return () => {
      // Never reached as the admin is built today (every navigation that replaces the
      // root is a document load), and present for the day one is not: a marker left
      // behind by an unmounted root would be a wait that resolves on a page which has
      // not hydrated, which is worse than having no wait at all.
      document.documentElement.removeAttribute(HYDRATED_ATTRIBUTE);
    };
  }, []);
  return null;
}
