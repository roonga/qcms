/**
 * The scope carrier does what it exists for (ADR-38).
 *
 * `theme-tokens.test.ts` proves the token values and the cascade order by reading the
 * sheet, which is a model of the browser, and a model can agree with itself while the
 * CSS reaches nothing. This file loads the real stylesheets into a document and reads
 * `getComputedStyle` off real elements, so what is asserted is that the rules match
 * where they are supposed to and nowhere else:
 *
 *  - a container carrying `data-qcms-theme-scope` resolves the portal token set,
 *    colour and geometry, inside a document whose own `:root` carries a different one,
 *    which is the shape a preview island needs;
 *  - the treatment layer reaches controls inside such a container and does not reach a
 *    `[data-rac]` control outside one, which is the shape a host needs in order to
 *    import that sheet at all.
 *
 * On the environment: jsdom resolves the cascade for elements a rule matches directly,
 * which is what is measured below. `border-width` is unreliable in its shorthand
 * handling, reading `0px` on a matched element and an unmatched one alike, so the
 * high-contrast half is measured on `color-scheme`, which the HC scaffold sets on the
 * carrier itself. `box-shadow` no longer discriminates either, since an unset one now
 * resolves to `none` as in a browser, so the sheet's control-level flat-surfaces rule
 * is not pinned here and the assertion says so where it stands. The rendered-pixel
 * half of the contract lives in the portal's browser suite.
 *
 * Custom properties inherit here, as they do in CSS, so "not scoped" reads as the
 * host's value where the portal's would be wrong rather than as an empty string, which
 * is the sharper claim. An unset longhand resolves to its initial value while a
 * shorthand such as `border-radius` is still empty, which is why the two spellings sit
 * side by side below.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

/**
 * The treatment sheet, minus its `@theme` block: a Tailwind at-rule rather than a
 * selector rule, which jsdom's parser mis-reads as a rule with a garbage selector, and
 * also the one part of the sheet the carrier cannot contain.
 */
const COMPONENTS_CSS = readFileSync(
  join(import.meta.dirname, "theme-components.css"),
  "utf8",
).replace(/@theme\s*\{[^}]*\}/u, "");

/**
 * Stands in for a host application whose document root re-declares the same custom
 * properties on a plain `:root` later in source order, geometry included. What matters
 * is that the values differ from the portal's in both a colour and a geometry token,
 * so an island resolving the host's set instead of the portal's is visibly wrong.
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

// The carrier itself is cleared as deliberately as the rest: the last test stamps it
// on <html>, so a test appended below would otherwise inherit an already-scoped
// document, which is the silent-containment defect these assertions exist to catch.
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
    // colours would miss: the corners preset is a theme-level setting rather than a
    // palette one.
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

    // Without the carrier these attributes match nothing in the portal sheet, so this
    // container resolves the host's own `:root` values by ordinary custom-property
    // inheritance. Naming those values is what makes the claim exact, and the pair of
    // negatives below keeps a future token change from making the two sets coincide.
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

    // The positive half only, and a weak one: an unset `box-shadow` now resolves to
    // `none` too, so neither side of the carrier tells a matched rule from an unmatched
    // one. The control-level flat-surfaces rule is therefore not pinned here at all
    // and this line would still read `none` if it were deleted from the sheet; it is
    // measured on rendered pixels in the portal's browser suite.
    expect(token(inside, "box-shadow")).toBe("none");

    // Containment, measured on the HC declaration whose two sides still read
    // differently: `color-scheme: light` sits on the carrier and reaches the control
    // inside it by inheritance, while a control outside keeps the initial `normal`. So
    // this pins the containment of the carrier's own declaration; the control-level
    // half is the test below.
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
