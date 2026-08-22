import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTIONS } from "../lib/settings-sections.ts";

/**
 * The Settings rail's MARKUP contract (`plan/admin-design-contracts.md` §7a, issue 562).
 *
 * Each assertion here is a clause of §7a that a future change could break without breaking
 * anything else:
 *
 * - **Same-page section links, and nothing else.** Every row is a bare `#fragment`. A row
 *   whose href started with `/` would be a route, and a route in this rail is the exact
 *   thing that turns the written exception into a third contract.
 * - **Anchors, not buttons**, asserted by counting `<button>` - which is also how "no
 *   actions" is asserted, because the two clauses have the same tell.
 * - **No counts.** §7's rail badges its steps; this one carries no `qcms-tag` at all.
 * - **A disclosure that is a real one**, so the collapsed state is keyboard-operable and
 *   announced by the browser rather than by an `aria-expanded` written by hand.
 * - **No headings.** The rail renders before `<main>` in document order, so a heading here
 *   would sit above the screen's `<h1>` and be a `heading-order` violation.
 * - **No `next/link`.** A fragment on the current route is the browser's own navigation,
 *   and routing it through the App Router would re-render the screen the reader is standing
 *   on. The stub below would let one through, so the assertion is on the module list.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can see the whole rail at once without a
 * browser (ADR-23). What genuinely needs one is `apps/admin/e2e/settings-rail.pw.ts`: the
 * 240px track turning on at `--bp-sidebar`, the `:target` mark, the summary naming the
 * active section, and the whole rail working with JavaScript disabled are every one of them
 * a computed style or an interaction rather than markup.
 *
 * ## The alias bridge
 *
 * Same device the app's other component tests use: the admin imports itself through `@/`
 * and the Vitest project has no resolver for it, so each factory hands back the real module
 * by its relative path. Nothing here is stubbed.
 */

vi.mock("@/lib/i18n/en", () => import("../lib/i18n/en.ts"));
vi.mock("@/lib/settings-sections", () => import("../lib/settings-sections.ts"));

async function render(): Promise<string> {
  const { SettingsSectionRail } = await import("./settings-section-rail.tsx");
  return renderToStaticMarkup(<SettingsSectionRail />);
}

describe("the Settings rail's markup", () => {
  it("is a navigation landmark named for the sections it carries", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('data-testid="qcms-settings-rail"');
    // The shared geometry class, because §7a's four shared things are the stylesheet's.
    expect(html).toContain('class="qcms-rail qcms-settings-rail"');
  });

  it("carries one bare fragment anchor per section, in document order", async () => {
    const html = await render();
    const anchors = [...html.matchAll(/<a class="[^"]*" href="([^"]+)"/gu)].map(
      (match) => match[1] ?? "",
    );
    expect(anchors).toStrictEqual(SETTINGS_SECTIONS.map((section) => `#${section.id}`));
    // Not a route, not a query, not the current path re-stated: a fragment and nothing else.
    expect(anchors.every((href) => href.startsWith("#"))).toBe(true);
  });

  it("holds no button, which is both 'anchors not buttons' and 'no actions'", async () => {
    const html = await render();
    expect(html).not.toContain("<button");
  });

  it("carries no count, no badge and no divider, because §7a gives it none", async () => {
    const html = await render();
    expect(html).not.toContain("qcms-tag");
    expect(html).not.toContain("qcms-rail__divider");
    // One group, so nothing to divide and no group name to repeat the landmark's.
    expect([...html.matchAll(/<ul /gu)]).toHaveLength(1);
  });

  it("holds no heading, so it cannot break heading order on the screen below it", async () => {
    const html = await render();
    expect(html).not.toMatch(/<h[1-6][\s>]/u);
  });

  it("collapses into a native details, open, so the disclosure needs no script", async () => {
    const html = await render();
    expect(html).toContain('<details class="qcms-rail__disclosure" open=""');
    expect(html).toContain('<summary class="qcms-rail__summary">');
  });

  it("puts every section name plus a fallback in the summary, for CSS to choose between", async () => {
    const html = await render();
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    // The fallback first, because it is what the summary says before the URL names a
    // section: the rail does not guess at the topmost one.
    expect(summary).toContain('data-settings-summary=""');
    expect(summary).toContain("Sections");
    for (const section of SETTINGS_SECTIONS) {
      expect(summary, `the ${section.id} section's name is in the summary`).toContain(
        `data-settings-summary="${section.id}"`,
      );
    }
  });

  it("reaches for no router, because a fragment on this route is the browser's own", () => {
    // A `next/link` with a fragment href would render the same `<a>` and behave differently:
    // the App Router would re-render the screen the reader is standing on, emptying a
    // half-typed password field on the way. Asserted at the source, since the markup cannot
    // tell the two apart.
    const source = readFileSync(
      fileURLToPath(new URL("./settings-section-rail.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain('from "next/link"');
  });

  it("gives every row the visually-hidden phrase that replaces aria-current", async () => {
    const html = await render();
    // A stylesheet cannot set `aria-current`, so the non-visual half of the active mark is
    // this phrase, revealed by the same `:target` rule. One per row, hidden until it is the
    // one the URL names.
    expect([...html.matchAll(/qcms-settings-rail__current/gu)]).toHaveLength(
      SETTINGS_SECTIONS.length,
    );
    expect(html).toContain("Current section");
    // And nothing is marked current in the markup itself: the URL decides, not the server.
    expect(html).not.toContain("aria-current");
  });
});
