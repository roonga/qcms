"use client";

import { useEffect } from "react";

import {
  TOPBAR_HEIGHT_PROPERTY,
  TOPBAR_LAYOUT_HEIGHT_PROPERTY,
  TOPBAR_SELECTOR,
} from "@/lib/topbar";

/* Round scroll padding up to keep focus below fractional bar heights; keep exact height for rail geometry
   and clear both on unmount. */
export function TopbarHeight(): null {
  useEffect(() => {
    const bar = document.querySelector(TOPBAR_SELECTOR);
    const root = document.documentElement;
    if (bar === null) return;

    const publish = (): void => {
      const height = bar.getBoundingClientRect().height;
      root.style.setProperty(TOPBAR_HEIGHT_PROPERTY, `${String(Math.ceil(height))}px`);
      root.style.setProperty(TOPBAR_LAYOUT_HEIGHT_PROPERTY, `${String(height)}px`);
    };

    publish();
    // Observe the bar itself: font loading and translated wrapping can change its height without a window
    // resize.
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(TOPBAR_HEIGHT_PROPERTY);
      root.style.removeProperty(TOPBAR_LAYOUT_HEIGHT_PROPERTY);
    };
  }, []);
  return null;
}
