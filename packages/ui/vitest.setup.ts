import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks a few browser APIs react-aria-components touches (media queries,
// resize observation, scrolling into view). Stub them so the controls mount and
// interact cleanly in the component layer; none affect the accessibility tree or
// the axe checks.
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
