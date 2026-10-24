import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks browser APIs react-aria-components touches, so these shims let the
// controls mount; none affects the accessibility tree or the axe checks. Each is
// written as a conditional so a jsdom release that grows one is a silent improvement
// rather than a double install.
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

// react-aria-components' ListBox calls `CSS.escape`, which jsdom 30 provides natively,
// so this shim only installs on an older one.
if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = {
    escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  } as unknown as typeof globalThis.CSS;
}

afterEach(() => {
  cleanup();
});
