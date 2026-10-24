import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SETTINGS_SECTION_IDS, SETTINGS_SECTIONS } from "../lib/settings-sections.ts";
import type { SettingsSectionId } from "../lib/settings-sections.ts";

/**
 * The Settings rail's MARKUP contract (issue 655; rebuilt onto the one frame by #1116).
 *
 * Each assertion here is a clause of `plan/admin-design-contracts.md` §7.0 that a future
 * change could break without breaking anything else:
 *
 * - **Anchors, not buttons** (§7.0 ruling 2.2). This file used to assert the opposite, by
 *   counting in both directions, because `plan/admin-shell-poc/settings-newquestion-poc.html`
 *   draws `<button onclick="showSettingsPanel(...)">` and issue 655 existed to undo an
 *   earlier fragment-anchor build. The ruling settles it the other way for every rail row,
 *   and the counting is kept - pointed the other way - because "one rail, one kind of row"
 *   is the sort of clause that erodes a screen at a time.
 * - **Each row links to its section id**, which is the address `components/account-menu.tsx`
 *   has published since task 032.
 * - **`aria-current="page"` on exactly one row**, and on the one the URL opened with. It is
 *   the whole of the accessible statement of which section is showing.
 * - **The Header says "Settings"** rather than naming the active section: the `<h1>` does
 *   that. Settings is a top-level screen, so the Header has no back link.
 * - **No counts and no actions.** This screen has neither.
 * - **A disclosure that is a real one**, so the collapsed state is keyboard-operable and
 *   announced by the browser rather than by an `aria-expanded` written by hand.
 * - **No headings.** The rail renders before `<main>` in document order, so a heading here
 *   would sit above the screen's `<h1>` and be a `heading-order` violation.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can see the whole rail at once without a
 * browser (ADR-23). The switch itself is an interaction across two React trees and is
 * asserted in `apps/admin/e2e/settings-rail.pw.ts`, along with the 240px track and the
 * collapse boundary, which are computed styles rather than markup.
 *
 * ## Nothing here is stubbed
 *
 * Including the switch: a static render never reaches the store's setter, and the value it
 * reads is the prop.
 */

async function render(initial: SettingsSectionId = SETTINGS_SECTION_IDS.account): Promise<string> {
  const { SettingsSectionRail } = await import("./settings-section-rail.tsx");
  return renderToStaticMarkup(<SettingsSectionRail initial={initial} />);
}

describe("the Settings rail's markup", () => {
  it("is a complementary landmark named for its subject, holding the sections nav", async () => {
    const html = await render();
    // The `<aside>` is named for the SUBJECT and the navigation inside it for that
    // subject's sections (§7.0 ruling 2). Both, because the pair is what stops a screen
    // reader meeting two unnamed landmarks on a screen that has a topbar nav as well.
    expect(html).toMatch(/^<aside class="qcms-rail" aria-label="Settings"/u);
    expect(html).toContain('<nav aria-label="Settings sections">');
    expect(html).toContain('data-testid="qcms-settings-rail"');
    // One geometry class, with no per-rail modifier beside it: the grid column, the 240px
    // track and the collapse are the frame's and are the same on every screen.
    expect(html).toContain('class="qcms-rail"');
    expect(html).not.toContain("qcms-settings-rail__");
  });

  it("draws every row as an anchor to its section, which is the clause #1116 turns on", async () => {
    const html = await render();
    const rows = [...html.matchAll(/<a [^>]*class="qcms-rail__link"[^>]*>/gu)];
    expect(rows).toHaveLength(SETTINGS_SECTIONS.length);
    for (const section of SETTINGS_SECTIONS) {
      expect(html, "a row links to the fragment that selects its panel").toContain(
        `href="#${section.id}"`,
      );
    }
    // And no button anywhere in the rail, which is the other half of the tell: this screen
    // has no actions either, so a `<button>` here could only be a row that had regressed.
    expect(html).not.toContain("<button");
  });

  it("marks exactly one row current, and it is the section the screen opened with", async () => {
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(1);
    // The mark is on the row it belongs to, not merely somewhere: located from the row's own
    // id, which is derived from the panel it shows.
    const marked = /<a [^>]*aria-current="page"[^>]*>/u.exec(html)?.[0] ?? "";
    expect(marked).toContain('id="rail-settings-panel-twofactor"');
    expect(marked).toContain('aria-controls="settings-panel-twofactor"');
  });

  it("names the screen in the Header, not the active section, and offers no way back", async () => {
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    // The POC's wording, and the reason it is safe to say only this: the `<h1>` beside the
    // rail names the section, so a summary that also did would be the third copy of it.
    expect(summary).toContain("Settings");
    expect(summary).not.toContain("Two-factor authentication");
    // Settings is the one row of §7.0's table whose Header has nothing to go back to, so
    // the back link is absent rather than pointing at the shell's home.
    expect(html).not.toContain("qcms-rail__back");
  });

  it("carries every section's name as a row, in reading order", async () => {
    const html = await render();
    const rows = [...html.matchAll(/<a [^>]*data-settings-rail-item="([^"]+)"/gu)].map(
      (match) => match[1] ?? "",
    );
    expect(rows).toStrictEqual(SETTINGS_SECTIONS.map((section) => section.id));
  });

  it("carries no count, no badge, no actions, and one group", async () => {
    const html = await render();
    // No status tag and no count in the Header: this screen has neither a status nor
    // anything to count, and §7.0 allows at most one of each.
    expect(html).not.toContain("qcms-tag");
    expect(html).not.toContain("qcms-rail__actions");
    // One group, so nothing to divide and no group name to repeat the nav's own.
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

  it("reaches for no router, because a fragment is not a route", () => {
    // A `next/link` in this rail would be a route where the screen has a panel switch, and
    // the markup cannot tell an `<a href="#x">` written by hand from one Link produced, so
    // this is asserted at the source where it stays unambiguous.
    // `join(dirname(...))` and NOT `new URL("./settings-section-rail.tsx", import.meta.url)`,
    // which is what this was. `new URL(<string literal>, import.meta.url)` is Vite's asset
    // syntax and is rewritten at transform time, so the resolved base becomes the page
    // location rather than this file: under the jsdom project added by issue #352 it came
    // back as an `http:` URL under jsdom's own document origin, and `fileURLToPath` refused
    // it for not being a file URL. The rewrite only fires on a literal, which is why the
    // same call written through a variable elsewhere never showed it. This is the shape
    // `app/(shell)/table-anchors.test.tsx` already uses, and it reads the same under both
    // environments.
    const here = fileURLToPath(import.meta.url);
    const source = readFileSync(join(dirname(here), "settings-section-rail.tsx"), "utf8");
    expect(source).not.toContain('from "next/link"');
    // And it DOES reach for the shared frame, which is the reversal #1116 is: this rail
    // used to re-type the disclosure chrome locally so that no later reader could "unify"
    // three rails, and §7.0 unified them deliberately. Asserted on the import lines, so a
    // copy of the chrome creeping back in cannot pass by keeping the import beside it.
    const imports = source.split("\n").filter((line) => line.startsWith("import"));
    expect(imports.some((line) => line.includes("rail-frame"))).toBe(true);
    expect(imports.some((line) => line.includes("rail-disclosure"))).toBe(false);
  });
});
