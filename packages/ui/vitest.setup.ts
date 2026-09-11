import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks a few browser APIs react-aria-components touches (media queries,
// resize observation, scrolling into view). Stub them so the controls mount and
// interact cleanly in the component layer; none affect the accessibility tree or
// the axe checks.
// Re-verified against jsdom 30.0.1 at the 26 -> 30 bump (issue #113). `matchMedia`,
// `ResizeObserver` and `scrollIntoView` are still absent, so those three shims still
// install. `CSS` is NOT: jsdom 30.0.0 added native `CSS.escape()` and `CSS.supports()`
// (https://github.com/jsdom/jsdom/releases/tag/v30.0.0), so the `typeof` guard below
// now skips the shim and react-aria reaches jsdom's own spec-correct `escape()`. The
// guard is what keeps that a silent improvement rather than a double install, which is
// why each shim is written as a conditional rather than an assignment.
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

// jsdom does not expose the global CSS object; react-aria-components' ListBox
// (Select's popover) calls CSS.escape. A minimal, spec-correct-enough shim.
if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = {
    escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  } as unknown as typeof globalThis.CSS;
}

afterEach(() => {
  cleanup();
});
