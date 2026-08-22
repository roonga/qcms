import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTION_IDS, SETTINGS_SECTIONS } from "../lib/settings-sections.ts";
import type { SettingsSectionId } from "../lib/settings-sections.ts";

/**
 * The Settings panels' MARKUP contract (issue 655).
 *
 * The clause `plan/admin-shell-poc/settings-newquestion-poc.html` turns on: three panels, one
 * of them showing, the other two carrying `hidden` rather than merely scrolled past, and one
 * `<h1>` naming whichever is showing. Its own reason is that account, change password and
 * two-factor authentication are "three genuinely separate surfaces, and stacking all three in
 * one scroll was hiding that".
 *
 * A static render is the right layer for that: `hidden` is an attribute, the heading's text is
 * a string, and both are decided before any browser is involved. What needs one is the switch
 * across the two React trees, which is `apps/admin/e2e/settings-rail.pw.ts`.
 *
 * The alias bridge is the same device the app's other component tests use: the admin imports
 * itself through `@/` and the Vitest project has no resolver for it.
 */

vi.mock("@/lib/i18n/en", () => import("../lib/i18n/en.ts"));
vi.mock("@/lib/settings-sections", () => import("../lib/settings-sections.ts"));
vi.mock("@/lib/settings-panel", () => import("../lib/settings-panel.ts"));

/** Each panel's body is a sentence naming it, so a mis-keyed panel is visible in the output. */
const PANELS = {
  account: <p>ACCOUNT BODY</p>,
  "change-password": <p>PASSWORD BODY</p>,
  "two-factor": <p>TWO FACTOR BODY</p>,
} as const;

async function render(initial: SettingsSectionId): Promise<string> {
  const { SettingsPanels } = await import("./settings-panels.tsx");
  return renderToStaticMarkup(<SettingsPanels initial={initial} panels={PANELS} />);
}

/** Every panel element in the render, with the id it carries and whether it is hidden. */
function panels(html: string): { readonly id: string; readonly hidden: boolean }[] {
  return [...html.matchAll(/<div id="(settings-panel-[^"]+)"([^>]*)>/gu)].map((match) => ({
    id: match[1] ?? "",
    hidden: (match[2] ?? "").includes("hidden"),
  }));
}

describe("the Settings panels", () => {
  it("renders all three, named the way the POC names them, in reading order", async () => {
    const rendered = panels(await render(SETTINGS_SECTION_IDS.account));
    expect(rendered.map((panel) => panel.id)).toStrictEqual(
      SETTINGS_SECTIONS.map((section) => section.panelId),
    );
  });

  it("shows exactly one and hides the other two, whichever one is showing", async () => {
    for (const section of SETTINGS_SECTIONS) {
      const rendered = panels(await render(section.id));
      const shown = rendered.filter((panel) => !panel.hidden);
      expect(
        shown.map((panel) => panel.id),
        `${section.id} is the only panel shown`,
      ).toStrictEqual([section.panelId]);
    }
  });

  it("hides them with the attribute, not by moving them off screen", async () => {
    // `hidden` is what takes a panel out of the accessibility tree as well as the layout. A
    // panel merely scrolled past, or clipped, is still read and still tabbed into - which is
    // the shape this screen had before, and the thing the POC's comment calls hiding the
    // difference between three separate surfaces.
    const html = await render(SETTINGS_SECTION_IDS.account);
    expect([...html.matchAll(/hidden=""/gu)]).toHaveLength(2);
    // And the class the stylesheet needs to out-specify the framework's zero-specificity
    // `[hidden]` reset is on every one of them, not only on the hidden two.
    expect([...html.matchAll(/class="qcms-settings-panel"/gu)]).toHaveLength(3);
  });

  it("puts each panel's own body in its own panel", async () => {
    const html = await render(SETTINGS_SECTION_IDS.changePassword);
    const password = html.slice(
      html.indexOf('<div id="settings-panel-password"'),
      html.indexOf('<div id="settings-panel-twofactor"'),
    );
    expect(password).toContain("PASSWORD BODY");
    expect(password).not.toContain("ACCOUNT BODY");
  });

  it("gives the screen one h1, naming the section rather than the screen", async () => {
    // The POC's reason: "Settings" already lives in the rail summary and the topbar, so a
    // third copy above the panel says nothing the reader does not already have.
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    expect([...html.matchAll(/<h1/gu)]).toHaveLength(1);
    expect(html).toContain('<h1 id="settings-page-heading"');
    expect(html).toContain("Two-factor authentication</h1>");

    const account = await render(SETTINGS_SECTION_IDS.account);
    expect(account).toContain("Account</h1>");
    expect(account).not.toContain("Two-factor authentication</h1>");
  });
});
