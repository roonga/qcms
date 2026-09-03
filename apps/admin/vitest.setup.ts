import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * The jsdom setup for the admin's component-test project (issue #352).
 *
 * Deliberately the same file `packages/ui/vitest.setup.ts` is, because the admin renders
 * the same vendored a2-react-aria controls through `components/kit.tsx` and so trips the
 * same missing browser APIs. It is duplicated rather than imported: a setup file is
 * project configuration, and reaching into another workspace member's config to get it
 * would make `@qcms/ui`'s test wiring part of the admin's public surface.
 *
 * None of these shims affect the accessibility tree. They exist so a control mounts at
 * all under jsdom, which lacks media queries, resize observation, scrolling into view,
 * and the global `CSS` object react-aria's ListBox calls `CSS.escape` on.
 */

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = {
    escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  } as unknown as typeof globalThis.CSS;
}

afterEach(() => {
  cleanup();
});
