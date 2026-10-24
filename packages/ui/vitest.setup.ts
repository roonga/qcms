import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Shims for browser APIs jsdom lacks, each conditional so a jsdom release that grows
// one is a silent improvement rather than a double install.
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
