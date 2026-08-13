import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Runs for every test file in the `qcms-admin` project, jsdom or not - Vitest's
 * per-file `// @vitest-environment jsdom` override does not extend to which
 * `setupFiles` run, only to which environment a given file gets. Everything below is
 * therefore guarded on `window` actually existing: under the project's default Node
 * environment (every pre-041 admin test), this file is a no-op.
 *
 * The shims themselves are the same ones `packages/ui/vitest.setup.ts` carries, for
 * the same reason: the kit's components (`@qcms/ui/kit`) are the identical vendored
 * react-aria-components that setup was written for, and jsdom lacks a few browser
 * APIs they touch (media queries, resize observation, `CSS.escape`). None affect what
 * a test asserts about the accessible tree or the rendered DOM.
 */
if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
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
}
