"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { mainClassFor } from "@/lib/measure";

/**
 * The shell's content column, capped by the route it is showing (issue 558).
 *
 * A client component for exactly one reason, and it is the same reason `AdminNav` is one:
 * a Next layout wraps the page tree and is never told which child route rendered, so a
 * decision made per route has to be taken where the pathname is readable. `usePathname`
 * is readable during the SERVER render of a client component too, so the cap is in the
 * first HTML the browser parses. Nothing here waits for hydration and nothing changes on
 * hydration, which is what keeps the column from resizing under a reader after the first
 * paint.
 *
 * The component owns no width of its own, and since issue 655 no alignment either. It asks
 * `lib/measure.ts` and renders what it is given, so the sixteen answers stay in one table
 * rather than becoming a condition here.
 *
 * WHY THE TOPBAR AND FOOTER STILL DO NOT FOLLOW THE ROUTE, and what changed anyway. They
 * take no cap at all now (issue 648): every POC's `.topbar__inner` has no `max-width` and
 * no auto margin, so the bar spans the viewport and starts at the page's inline padding.
 * That removes the reason this note used to exist - the bar no longer carries a DIFFERENT
 * cap from the column, it carries none - while keeping the bar off the route table, which
 * is still right: tying chrome to the route cap would make the bar reflow on navigation,
 * narrower on the preview screens, where five nav items plus the trailing controls would
 * begin to wrap. Chrome that spans and content that is capped share their left edge and
 * disagree about nothing else.
 */
export function MeasuredMain({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  // The whole attribute comes from the table, because the cap and the alignment are one
  // answer per route: sixteen caps read off sixteen drawings (issue 657) and one alignment
  // they all share, left, which is expressed as `mx-auto` never being emitted (issue 648).
  return (
    <main id="main-content" className={mainClassFor(pathname)}>
      {children}
    </main>
  );
}
