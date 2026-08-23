"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The rail's disclosure, and the one thing all three rails genuinely share about it: it is
 * SHUT by default below `--bp-sidebar` and open above it (Code Owner decision, 2026-08-23).
 *
 * §7a lists "the `--bp-sidebar` collapse behaviour" among the four things the rails share,
 * which is why this is one component rather than three copies. It carries no opinion about
 * what a rail contains, exactly as `components/rail-frame.tsx` and the `qcms-rail*` geometry
 * do not.
 *
 * ## Why the state is decided in the browser rather than by a media query
 *
 * `open` is an attribute, and no media query can set one. The alternatives were weighed and
 * both were worse:
 *
 * - **Two `<details>` elements, one per width, with one hidden.** A second copy of the
 *   navigation is a second set of links for a screen reader to walk, which is the reason
 *   this app has had one disclosure at every width since the rail was built.
 * - **One always-shut `<details>`, with `::details-content` forced visible above the
 *   boundary.** No script and no flash, and it makes the element LIE: with no `open`
 *   attribute the browser announces "collapsed" while the rows are on screen and in the tab
 *   order. `docs/admin-constraints.md` says the accessible option wins where it is available
 *   at reasonable cost, and here it is.
 *
 * So the element's state is real at every width, and the media query is read where a media
 * query can be read.
 *
 * ## Why there is no flash, and what is true before hydration
 *
 * The server cannot know the viewport, so the first HTML is `open` - the safe answer, and
 * the one a reader with no JavaScript keeps. On a narrow viewport that would paint an
 * expanded rail for the frame before hydration, so `app/globals.css` hides the body below
 * the boundary until this component has run, keyed off `data-ready`. The two together mean:
 * a narrow viewport paints shut and stays shut, a wide one paints open and stays open, and
 * a scriptless reader gets the whole rail rather than a summary they cannot expand.
 *
 * The window between first paint and hydration is the one moment the attribute and the
 * picture disagree on a narrow viewport, and it is the trade this file makes rather than
 * the one it hides.
 *
 * ## Resizing across the boundary re-decides it
 *
 * A reader who widens the window gets the sidebar open, and one who narrows it gets it shut,
 * because the listener is live. That also discards a manual toggle, which is the right way
 * round: the toggle is about the width the reader is at.
 */
export function RailDisclosure({ children }: { readonly children: ReactNode }) {
  // `undefined` until the browser has answered, which is what `data-ready` publishes to the
  // stylesheet. It is deliberately not `false`: a `false` here would make the server's HTML
  // and the first client render disagree about `open`.
  const [wide, setWide] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    // 64rem is `--bp-sidebar`, in the unit §1 writes both breakpoints in so they move with
    // an operator's browser font size. `matchMedia` resolves the `rem` against the root
    // font size the same way the stylesheet does, so the two boundaries cannot drift.
    const query = window.matchMedia("(min-width: 64rem)");
    const sync = (): void => {
      setWide(query.matches);
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
    };
  }, []);

  return (
    <details
      className="qcms-rail__disclosure"
      open={wide ?? true}
      {...(wide === undefined ? {} : { "data-ready": "" })}
    >
      {children}
    </details>
  );
}
