// `theme-tokens.test.ts` models the browser by reading the sheet, which can agree with itself while the CSS
// reaches nothing, so this loads the real stylesheets and reads `getComputedStyle`. jsdom measures `color-scheme`
// because its `border-width` shorthand handling is unreliable; custom properties inherit as in CSS.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

/**
 * Minus the `@theme` block, which jsdom's parser mis-reads as a rule with a garbage
 * selector and which the carrier cannot contain anyway.
 */
const COMPONENTS_CSS = readFileSync(
  join(import.meta.dirname, "theme-components.css"),
  "utf8",
).replace(/@theme\s*\{[^}]*\}/u, "");

/**
 * A host whose `:root` re-declares the same properties later in source order. The
 * values differ from the portal's in both a colour and a geometry token, so an island
 * resolving the host's set instead of the portal's is visibly wrong.
 */
const HOST_ROOT_CSS = `
:root {
  --radius-control: 4px;
  --radius-card: 8px;
  --radius-sm: 2px;
  --color-primary: #1e40d0;
  --color-text: #101828;
  --color-background: #f4f6fb;
}
`;

function loadSheets(...sheets: readonly string[]): void {
  document.head.innerHTML = sheets.map((sheet) => `<style>${sheet}</style>`).join("");
}

function token(element: Element, name: string): string {
  return globalThis.getComputedStyle(element).getPropertyValue(name).trim();
}

// The last test stamps the carrier on <html>, so without clearing it a test appended
// below would inherit an already-scoped document, which is the silent-containment
// defect these assertions exist to catch.
afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-qcms-theme-scope");
});

describe("a scoped container resolves the portal token set", () => {
  function mountIsland(attributes: string): HTMLElement {
    document.body.innerHTML = `<div id="island" data-qcms-theme-scope ${attributes}></div>`;
    const island = document.querySelector("#island");
    expect(island).not.toBeNull();
    return island as HTMLElement;
  }

  it("gives the container the portal's colour AND geometry while the root keeps the host's", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    const island = mountIsland('data-theme="harbor" class="dark"');

    // The divergence an island that re-declared only colours would miss.
    expect(token(island, "--radius-control")).toBe("6px");
    expect(token(island, "--radius-card")).toBe("10px");
    expect(token(document.documentElement, "--radius-control")).toBe("4px");

    expect(token(island, "--color-primary")).toBe("#6fa8ff");
    expect(token(island, "--color-background")).toBe("#08111f");
    expect(token(document.documentElement, "--color-primary")).toBe("#1e40d0");
  });

  it("resolves the shared High-contrast layer on the container, not on the root", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    const island = mountIsland('data-theme="sand" class="hc"');

    expect(token(island, "--color-text")).toBe("#000000");
    expect(token(island, "--color-background")).toBe("#ffffff");
    expect(token(island, "--color-primary")).toBe("#7a3717");
    expect(token(document.documentElement, "--color-text")).toBe("#101828");
  });

  it("keeps the document root working: the same sheet still themes :root", () => {
    loadSheets(THEME_CSS);
    document.documentElement.setAttribute("data-theme", "plum");
    document.documentElement.className = "dark radius-pill";

    expect(token(document.documentElement, "--color-primary")).toBe("#c08cf0");
    expect(token(document.documentElement, "--radius-control")).toBe("999px");
  });

  it("gives a container without the carrier the host's tokens, never the portal's", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    document.body.innerHTML = `<div id="plain" data-theme="harbor" class="dark"></div>`;
    const plain = document.querySelector("#plain");
    expect(plain).not.toBeNull();

    // Without the carrier these attributes match nothing in the portal sheet, so the
    // host's own `:root` values reach here by inheritance. The pair of negatives below
    // keeps a future token change from making the two sets coincide.
    expect(token(plain as HTMLElement, "--radius-control")).toBe("4px");
    expect(token(plain as HTMLElement, "--color-primary")).toBe("#1e40d0");
    expect(token(plain as HTMLElement, "--radius-control")).not.toBe("6px");
    expect(token(plain as HTMLElement, "--color-primary")).not.toBe("#6fa8ff");
  });
});

describe("the treatment layer is contained by the carrier", () => {
  /** A host's own chrome is built from the same `[data-rac]` kit as these controls. */
  function mountBoth(): { readonly inside: HTMLElement; readonly outside: HTMLElement } {
    document.body.innerHTML = `
      <div data-qcms-theme-scope class="hc">
        <div data-qcms-field>
          <button id="inside" data-rac aria-haspopup="listbox" class="shadow-lg">in</button>
        </div>
      </div>
      <div data-qcms-field>
        <button id="outside" data-rac aria-haspopup="listbox" class="shadow-lg">out</button>
      </div>`;
    const inside = document.querySelector("#inside");
    const outside = document.querySelector("#outside");
    expect(inside).not.toBeNull();
    expect(outside).not.toBeNull();
    return { inside: inside as HTMLElement, outside: outside as HTMLElement };
  }

  it("applies the portal's High-contrast treatment inside the container only", () => {
    loadSheets(COMPONENTS_CSS);
    const { inside, outside } = mountBoth();

    // A weak assertion: an unset `box-shadow` now resolves to `none` too, so this
    // would still read `none` if the flat-surfaces rule were deleted from the sheet.
    // It is measured on rendered pixels in the portal's browser suite.
    expect(token(inside, "box-shadow")).toBe("none");

    // `color-scheme: light` sits on the carrier and reaches the control inside by inheritance, while one outside
    // keeps `normal`, so this pins containment of the carrier's own declaration.
    expect(token(inside, "color-scheme")).toBe("light");
    expect(token(outside, "color-scheme")).toBe("normal");
  });

  it("applies the radius and spacing treatment inside the container only", () => {
    loadSheets(COMPONENTS_CSS);
    const { inside, outside } = mountBoth();

    expect(token(inside, "border-radius")).toBe("var(--radius-control)");
    expect(token(inside, "min-height")).toBe("var(--space-control-h)");
    expect(token(inside, "padding-inline")).toBe("var(--space-control-pad-x)");

    // A host can import this sheet without restyling its own control layer. Under jsdom 30 an untouched shorthand
    // resolves to `""` and a longhand to its initial value (`auto` for `min-height`); both are asserted as-is.
    // Either way the treatment rule's `var(...)` is absent, which is the property under test.
    expect(token(outside, "border-radius")).toBe("");
    expect(token(outside, "min-height")).toBe("auto");
    expect(token(outside, "padding-inline")).toBe("");
  });

  it("still treats the whole document when the carrier is on <html>, as the portal stamps it", () => {
    loadSheets(COMPONENTS_CSS);
    document.documentElement.setAttribute("data-qcms-theme-scope", "");
    document.documentElement.className = "hc";
    const { outside } = mountBoth();

    expect(token(outside, "border-radius")).toBe("var(--radius-control)");
    // `color-scheme` rather than `box-shadow`, for the reason the header gives: the
    // flat-surfaces reading is the initial value as well since jsdom 30.1.3, so it
    // can no longer tell a treated control from an untreated one.
    expect(token(outside, "color-scheme")).toBe("light");
  });
});
