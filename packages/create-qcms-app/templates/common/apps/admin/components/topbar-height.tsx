"use client";

import { useEffect } from "react";

import { TOPBAR_HEIGHT_PROPERTY, TOPBAR_SELECTOR } from "@/lib/topbar";

/**
 * Publish the top bar's rendered height so the page's scroll padding can follow it
 * (issue #1011, WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum)).
 *
 * The defect, the alternatives and the reason a measurement is allowed here are all in
 * `lib/topbar.ts`. What is left for this file is the three decisions the code makes.
 *
 * **It queries for the bar rather than holding a ref to it.** The bar is server-rendered
 * by `app/(shell)/layout.tsx`, which is an async server component and can hold no ref, and
 * making the header a client component to get one would pull the wordmark, the nav wrapper
 * and the trailing group across the boundary for a number none of them care about. The
 * selector is shared with the spec that measures the same element, so the query cannot
 * drift from what it means to select.
 *
 * **It rounds up.** A wrapped bar measures a fractional height (145.5 at 390 on a device
 * pixel ratio that is not 1), and a scroll padding a fraction short of the bar leaves the
 * focused control a fraction behind it - visually nothing, and a test that is right to fail.
 * Up is the safe direction: a pixel of daylight under the bar is not a defect.
 *
 * **It removes the property on unmount.** Never reached as the shell is built today, and
 * present for the day it is: a stale height left on `<html>` by an unmounted shell would be
 * a scroll padding for a bar that is no longer there, which is worse than the derived
 * token this falls back to.
 */
export function TopbarHeight(): null {
  useEffect(() => {
    const bar = document.querySelector(TOPBAR_SELECTOR);
    const root = document.documentElement;
    if (bar === null) return;

    const publish = (): void => {
      const height = bar.getBoundingClientRect().height;
      root.style.setProperty(TOPBAR_HEIGHT_PROPERTY, `${String(Math.ceil(height))}px`);
    };

    publish();
    // The bar's height changes on a viewport resize, on a font swap, and on a locale whose
    // labels wrap at a different width. Observing the element covers all three, where a
    // `resize` listener covers only the first.
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(TOPBAR_HEIGHT_PROPERTY);
    };
  }, []);
  return null;
}
