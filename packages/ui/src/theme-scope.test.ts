/**
 * The scope carrier does what it exists for (task 060, ADR-38).
 *
 * `theme-tokens.test.ts` proves the token VALUES and the cascade order by reading
 * the sheet. That is a model of the browser, and a model can agree with itself
 * while the CSS reaches nothing. This file instead loads the real stylesheets into
 * a document and reads `getComputedStyle` off real elements, so what is asserted is
 * that the rules MATCH where they are supposed to and nowhere else:
 *
 *  - a container carrying `data-qcms-theme-scope` resolves the portal token set,
 *    colour AND geometry, inside a document whose own `:root` carries a different
 *    one (the shape task 058's preview island needs);
 *  - the treatment layer in `theme-components.css` reaches controls inside such a
 *    container and does NOT reach a `[data-rac]` control outside one (the shape the
 *    QCMS app needs in order to import that sheet at all).
 *
 * Every assertion here fails without the rewrite: with the sheets anchored on bare
 * `:root`, no rule matches a container element at all and each computed value comes
 * back empty.
 *
 * A note on the environment. jsdom resolves the cascade for elements a rule matches
 * directly, which is exactly what is measured below (the carrier element itself, and
 * the controls the treatment rules name). It does NOT implement custom-property
 * inheritance, so nothing here reads a token off a descendant - and `border-width`
 * is unreliable in its shorthand handling, so the high-contrast half is measured on
 * `box-shadow`, which its flat-surfaces rule sets. The rendered-pixel half of the
 * contract lives in `apps/portal/e2e/theming.pw.ts`, in a real browser.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

/**
 * The treatment sheet, minus its `@theme` block. That block is a Tailwind at-rule,
 * not a selector rule, and jsdom's CSS parser mis-reads it as a rule with a garbage
 * selector; it is also the one part of the sheet the carrier cannot contain, which
 * the sheet's own header says and `apps/admin/app/globals.css` handles.
 */
const COMPONENTS_CSS = readFileSync(
  join(import.meta.dirname, "theme-components.css"),
  "utf8",
).replace(/@theme\s*\{[^}]*\}/u, "");

/**
 * Stands in for a host application whose document root carries its own token values
 * - the QCMS app, whose Cobalt sheet (task 055) re-declares the same custom
 * properties on a plain `:root` later in source order, geometry included. The
 * values are that sheet's shape, not a copy of it: what matters is that they differ
 * from the portal's in both a colour and a geometry token, so an island that
 * resolved the host's values instead of the portal's is visibly wrong here.
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

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
});

describe("a scoped container resolves the portal token set", () => {
  /** A container carrying the carrier, a theme attribute and a mode class. */
  function mountIsland(attributes: string): HTMLElement {
    document.body.innerHTML = `<div id="island" data-qcms-theme-scope ${attributes}></div>`;
    const island = document.querySelector("#island");
    expect(island).not.toBeNull();
    return island as HTMLElement;
  }

  it("gives the container the portal's colour AND geometry while the root keeps the host's", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    const island = mountIsland('data-theme="harbor" class="dark"');

    // Geometry first, because it is the divergence an island that re-declared only
    // colours would miss: the host's corners are 4/8/2, the portal's Subtle preset
    // is 6/10/4, and the preset is a theme-level setting rather than a palette one.
    expect(token(island, "--radius-control")).toBe("6px");
    expect(token(island, "--radius-card")).toBe("10px");
    expect(token(document.documentElement, "--radius-control")).toBe("4px");

    // Colour: harbor's Dark accent, not slate's and not the host's.
    expect(token(island, "--color-primary")).toBe("#6fa8ff");
    expect(token(island, "--color-background")).toBe("#08111f");
    expect(token(document.documentElement, "--color-primary")).toBe("#1e40d0");
  });

  it("resolves the shared High-contrast layer on the container, not on the root", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    const island = mountIsland('data-theme="sand" class="hc"');

    expect(token(island, "--color-text")).toBe("#000000");
    expect(token(island, "--color-background")).toBe("#ffffff");
    // sand's AAA accent is the only thing High-contrast varies per theme.
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

  it("gives a container without the carrier nothing at all", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    document.body.innerHTML = `<div id="plain" data-theme="harbor" class="dark"></div>`;
    const plain = document.querySelector("#plain");
    expect(plain).not.toBeNull();
    expect(token(plain as HTMLElement, "--radius-control")).toBe("");
    expect(token(plain as HTMLElement, "--color-primary")).toBe("");
  });
});

describe("the treatment layer is contained by the carrier", () => {
  /**
   * One control inside a scoped high-contrast container and one identical control
   * outside it, which is the QCMS app's situation exactly: its chrome is built from
   * the same `[data-rac]` component kit as the portal's controls.
   */
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

    // Flat surfaces: the HC layer neutralizes every shadow utility it can reach.
    expect(token(inside, "box-shadow")).toBe("none");
    expect(token(outside, "box-shadow")).toBe("");
  });

  it("applies the radius and spacing treatment inside the container only", () => {
    loadSheets(COMPONENTS_CSS);
    const { inside, outside } = mountBoth();

    expect(token(inside, "border-radius")).toBe("var(--radius-control)");
    expect(token(inside, "min-height")).toBe("var(--space-control-h)");
    expect(token(inside, "padding-inline")).toBe("var(--space-control-pad-x)");

    // The half the whole approach exists for: a `[data-rac]` control outside a
    // carrier is untouched, so a host can import this sheet without restyling its
    // own control layer.
    expect(token(outside, "border-radius")).toBe("");
    expect(token(outside, "min-height")).toBe("");
    expect(token(outside, "padding-inline")).toBe("");
  });

  it("still treats the whole document when the carrier is on <html>, as the portal stamps it", () => {
    loadSheets(COMPONENTS_CSS);
    document.documentElement.setAttribute("data-qcms-theme-scope", "");
    document.documentElement.className = "hc";
    const { outside } = mountBoth();

    expect(token(outside, "border-radius")).toBe("var(--radius-control)");
    expect(token(outside, "box-shadow")).toBe("none");
  });
});
