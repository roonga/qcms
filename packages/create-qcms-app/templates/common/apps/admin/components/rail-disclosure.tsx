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
  // Open until the browser has answered, which is the server's answer and the one a reader
  // with no JavaScript keeps. `ready` is the separate fact - whether the media query has
  // been read yet - because the two stopped being the same thing once a reader could
  // toggle `open` themselves.
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  // Whether the rail is a permanent sidebar rather than a disclosure. Above the boundary it
  // is, so there is nothing to collapse and the summary stops being a control - see the
  // click handler below.
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    // 64rem is `--bp-sidebar`, in the unit §1 writes both breakpoints in so they move with
    // an operator's browser font size. `matchMedia` resolves the `rem` against the root
    // font size the same way the stylesheet does, so the two boundaries cannot drift.
    const query = window.matchMedia("(min-width: 64rem)");
    const sync = (): void => {
      setPinned(query.matches);
      // Only when the boundary itself moves. Re-deciding on every render is what
      // overrode the reader's own toggle; re-deciding on a resize across the boundary is
      // the behaviour this component is for.
      setOpen(query.matches);
      setReady(true);
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
      open={open}
      // THE READER'S TOGGLE HAS TO SURVIVE THE NEXT RENDER, and without this it did not.
      // `open` is driven from state, so every re-render reasserted the width's answer and
      // slammed a rail the reader had just opened. On most screens that is invisible
      // because little re-renders; on the builder, where the draft, its autosave and its
      // validation all re-render as an author types, a rail opened at 390 shut itself
      // immediately and the steps inside it could not be reached at all. Reading the
      // element's own state back is what makes this a disclosure the reader owns between
      // breakpoint changes rather than one the component overrides.
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      // ABOVE `--bp-sidebar` THE SUMMARY IS A LABEL, NOT A CONTROL (Code Owner,
      // 2026-08-26). The rail is a permanent sidebar at that width - the stylesheet already
      // hides the chevron and sets `cursor: default` there - but the `<summary>` stayed
      // live, so clicking the form's name folded the whole rail away with no visible
      // affordance to put it back. Refusing the default on the summary's own click stops
      // it for the keyboard too, because Enter and Space on a summary dispatch a click.
      //
      // Not `pointer-events: none` in CSS: that stops the mouse and leaves Enter working,
      // which is the half of the problem a keyboard reader would have kept.
      onClickCapture={(event) => {
        if (!pinned) return;
        if ((event.target as HTMLElement).closest("summary") !== null) event.preventDefault();
      }}
      {...(ready ? { "data-ready": "" } : {})}
    >
      {children}
    </details>
  );
}
