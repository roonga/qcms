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
 * the controls the treatment rules name). `border-width` is unreliable in its
 * shorthand handling - it reads `0px` on a matched element and on an unmatched one
 * alike - so the high-contrast half is measured on `color-scheme`, which the HC
 * scaffold sets on the carrier itself and which still reads differently either side
 * of it. `box-shadow` is asserted too but no longer discriminates, so the sheet's
 * control-level flat-surfaces rule is not pinned here; the assertion says so where it
 * stands. The rendered-pixel half of the contract, that rule included, lives in
 * `apps/portal/e2e/theming.pw.ts`, in a real browser.
 *
 * Three things this file used to lean on stopped being true as jsdom caught up to the
 * browser, two at the jsdom 26 -> 30 bump (issue #113) and one at 30.1.3. None of the
 * three was jsdom drifting from the browser, so the assertions moved instead of the
 * expectations being relaxed:
 *
 *  - **Custom properties now inherit.** jsdom 26 resolved `--token` only on an
 *    element a rule matched directly and gave a descendant `""`; 29.0.2 applied
 *    computed-value rules "across a broader set of properties, and include fixes
 *    related to inheritance, defaulting keywords, custom properties"
 *    (https://github.com/jsdom/jsdom/releases/tag/v29.0.2). Custom properties are
 *    inherited properties in CSS, so a descendant of a themed `:root` resolving the
 *    root's value is correct. "Not scoped" therefore no longer reads as an empty
 *    string; it reads as the HOST's value where the portal's would be wrong, which
 *    is the sharper claim and the one asserted below.
 *  - **Longhands now default to their initial value.** jsdom 26 returned `""` for a
 *    longhand no rule set; jsdom 30 returns the initial value (`min-height: auto`),
 *    the last step of the same broadening plus 30.0.0's "Fixed `getComputedStyle()`
 *    to convert length values into pixels"
 *    (https://github.com/jsdom/jsdom/releases/tag/v30.0.0). Shorthands such as
 *    `border-radius` and `padding-inline` are still `""` when unset, so the two
 *    spellings sit side by side below on purpose.
 *  - **`box-shadow` joined them at 30.1.3.** jsdom 30.1.2 returned `""` for an unset
 *    `box-shadow`; 30.1.3 returns the initial value, `none`, which is what a browser
 *    returns, and its release notes list another round of computed-style fixes
 *    including "incorrect shorthand defaults and inheritance"
 *    (https://github.com/jsdom/jsdom/releases/tag/v30.1.3). This one cost a
 *    measurement rather than an expectation: `none` on a control inside a
 *    high-contrast carrier no longer differs from `none` on one outside, so asserting
 *    the pair would assert nothing. The containment half therefore moved onto
 *    `color-scheme`, which the HC layer sets to `light` on the carrier and which
 *    reaches the control inside it by ordinary inheritance while a control outside
 *    keeps the initial `normal`.
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

// The carrier itself is cleared here as deliberately as the rest: the last test in
// this file stamps it on <html>, and a test appended below would otherwise inherit a
// document that is already scoped - which is exactly the silent-containment defect
// the assertions above exist to catch.
afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-qcms-theme-scope");
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

  it("gives a container without the carrier the host's tokens, never the portal's", () => {
    loadSheets(THEME_CSS, HOST_ROOT_CSS);
    document.body.innerHTML = `<div id="plain" data-theme="harbor" class="dark"></div>`;
    const plain = document.querySelector("#plain");
    expect(plain).not.toBeNull();

    // `data-theme` and `dark` without the carrier match nothing in the portal sheet,
    // so what this container resolves is what any element of the host document
    // resolves: the host's `:root` values, reaching it by ordinary custom-property
    // inheritance. Naming those values is what makes the claim exact - an island
    // that silently picked up the portal set would read 6px and #6fa8ff here, which
    // the pair of negatives below pins directly so a future token change cannot make
    // the two sets coincide without reddening this test.
    expect(token(plain as HTMLElement, "--radius-control")).toBe("4px");
    expect(token(plain as HTMLElement, "--color-primary")).toBe("#1e40d0");
    expect(token(plain as HTMLElement, "--radius-control")).not.toBe("6px");
    expect(token(plain as HTMLElement, "--color-primary")).not.toBe("#6fa8ff");
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
    // The positive half only, and a weak one. Since jsdom 30.1.3 an unset
    // `box-shadow` resolves to its initial value, which is also `none`, so neither
    // side of the carrier can tell a matched rule from an unmatched one any more.
    // **The control-level flat-surfaces rule, `[data-qcms-theme-scope].hc
    // [class*="shadow-"]`, is therefore no longer pinned in jsdom at all**: this line
    // would still read `none` if that rule were deleted from the sheet. Where it IS
    // measured is `apps/portal/e2e/theming.pw.ts`, on rendered pixels in a real
    // browser, which is where this file's header already sends the rendered half of
    // the contract.
    expect(token(inside, "box-shadow")).toBe("none");

    // Containment, measured on the HC declaration whose two sides do still read
    // differently: `color-scheme: light` sits on the CARRIER and reaches the control
    // inside it by inheritance, while a `[data-rac]` control outside keeps the initial
    // `normal`. So what this pins is the containment of the carrier's own declaration,
    // not of a rule that matches a control. The control-level half is the test below,
    // whose `var(...)` readings do still tell a matched rule from an unmatched one,
    // and the two together are what let a host import this sheet without its own
    // control layer turning into HC.
    expect(token(inside, "color-scheme")).toBe("light");
    expect(token(outside, "color-scheme")).toBe("normal");
  });

  it("applies the radius and spacing treatment inside the container only", () => {
    loadSheets(COMPONENTS_CSS);
    const { inside, outside } = mountBoth();

    expect(token(inside, "border-radius")).toBe("var(--radius-control)");
    expect(token(inside, "min-height")).toBe("var(--space-control-h)");
    expect(token(inside, "padding-inline")).toBe("var(--space-control-pad-x)");

    // The half the whole approach exists for: a `[data-rac]` control outside a
    // carrier is untouched, so a host can import this sheet without restyling its
    // own control layer. "Untouched" has two spellings under jsdom 30 and both are
    // asserted as-is rather than normalized away: an unset SHORTHAND still resolves
    // to `""`, while an unset LONGHAND resolves to its initial value, which for
    // `min-height` is `auto`. Either way the treatment rule's `var(...)` is absent,
    // which is the property under test.
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
