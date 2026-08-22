import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTION_IDS, SETTINGS_SECTIONS } from "../lib/settings-sections.ts";
import type { SettingsSectionId } from "../lib/settings-sections.ts";

/**
 * The Settings rail's MARKUP contract (issue 655).
 *
 * Each assertion here is a clause of `plan/admin-shell-poc/settings-newquestion-poc.html` that
 * a future change could break without breaking anything else:
 *
 * - **Buttons, not anchors.** The POC draws `<button onclick="showSettingsPanel(...)">`, and
 *   the rebuild this file accompanies exists because the screen was built with fragment
 *   anchors instead. Asserted by counting, in both directions.
 * - **`aria-current="page"` on exactly one row**, and on the one the URL opened with. It is
 *   the whole of the accessible statement of which section is showing.
 * - **The summary says "Settings"**, the POC's own word, rather than naming the active
 *   section: the `<h1>` does that now.
 * - **No routes, no counts, no actions.** A row that navigated would make this a second
 *   route rail rather than a switch on one screen.
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
 * ## The alias bridge
 *
 * Same device the app's other component tests use: the admin imports itself through `@/` and
 * the Vitest project has no resolver for it, so each factory hands back the real module by
 * its relative path. Nothing here is stubbed, including the switch - a static render never
 * reaches the store's setter, and the value it reads is the prop.
 */

vi.mock("@/lib/i18n/en", () => import("../lib/i18n/en.ts"));
vi.mock("@/lib/settings-sections", () => import("../lib/settings-sections.ts"));
vi.mock("@/lib/settings-panel", () => import("../lib/settings-panel.ts"));

async function render(initial: SettingsSectionId = SETTINGS_SECTION_IDS.account): Promise<string> {
  const { SettingsSectionRail } = await import("./settings-section-rail.tsx");
  return renderToStaticMarkup(<SettingsSectionRail initial={initial} />);
}

describe("the Settings rail's markup", () => {
  it("is a navigation landmark named for the sections it carries", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('data-testid="qcms-settings-rail"');
    // The shared geometry class, because the grid column and the 240px track are the
    // stylesheet's and are shared with the route rail on other screens.
    expect(html).toContain('class="qcms-rail qcms-settings-rail"');
  });

  it("draws every row as a button, which is the clause this rebuild turns on", async () => {
    const html = await render();
    expect([...html.matchAll(/<button/gu)]).toHaveLength(SETTINGS_SECTIONS.length);
    for (const button of html.matchAll(/<button[^>]*>/gu)) {
      expect(button[0], "a rail button never submits anything").toContain('type="button"');
    }
    // And not a link in the rail, in either half of the tell: an `<a>` at all, or an href.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("marks exactly one row current, and it is the section the screen opened with", async () => {
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(1);
    // The mark is on the row it belongs to, not merely somewhere: located from the row's own
    // id, which is derived from the panel it shows.
    const marked = /<button[^>]*aria-current="page"[^>]*>/u.exec(html)?.[0] ?? "";
    expect(marked).toContain('id="rail-settings-panel-twofactor"');
    expect(marked).toContain('aria-controls="settings-panel-twofactor"');
  });

  it("names the screen in the summary, not the active section", async () => {
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    // The POC's wording, and the reason it is safe to say only this: the `<h1>` beside the
    // rail names the section, so a summary that also did would be the third copy of it.
    expect(summary).toContain("Settings");
    expect(summary).not.toContain("Two-factor authentication");
  });

  it("carries every section's name as a row, in reading order", async () => {
    const html = await render();
    const rows = [...html.matchAll(/<button[^>]*data-settings-rail-item="([^"]+)"/gu)].map(
      (match) => match[1] ?? "",
    );
    expect(rows).toStrictEqual(SETTINGS_SECTIONS.map((section) => section.id));
  });

  it("carries no count, no badge and no divider, because it has one group", async () => {
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

  it("reaches for no router, because nothing here is a navigation", () => {
    // A `next/link` in this rail would be a route where the POC draws a panel switch, and
    // the markup cannot tell an `<a href="#x">` written by hand from one Link produced. The
    // rail is buttons now, so this is asserted at the source where it stays unambiguous.
    const source = readFileSync(
      fileURLToPath(new URL("./settings-section-rail.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain('from "next/link"');
    // And it does not widen the shared rail chrome to fit itself: the disclosure below is
    // re-typed here on purpose, which is the whole reason `rail-frame.tsx` is untouched.
    expect(source).not.toContain("rail-frame");
  });
});
