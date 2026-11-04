import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SETTINGS_SECTION_IDS, SETTINGS_SECTIONS } from "../lib/settings-sections.ts";
import type { SettingsSectionId } from "../lib/settings-sections.ts";

const PANELS = {
  account: <p>ACCOUNT BODY</p>,
  "change-password": <p>PASSWORD BODY</p>,
  "two-factor": <p>TWO FACTOR BODY</p>,
} as const;

async function render(initial: SettingsSectionId): Promise<string> {
  const { SettingsPanels } = await import("./settings-panels.tsx");
  return renderToStaticMarkup(<SettingsPanels initial={initial} panels={PANELS} />);
}

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
    const html = await render(SETTINGS_SECTION_IDS.account);
    expect([...html.matchAll(/hidden=""/gu)]).toHaveLength(2);
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
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    expect([...html.matchAll(/<h1/gu)]).toHaveLength(1);
    expect(html).toContain('<h1 id="settings-page-heading"');
    expect(html).toContain("Two-factor authentication</h1>");

    const account = await render(SETTINGS_SECTION_IDS.account);
    expect(account).toContain("Account</h1>");
    expect(account).not.toContain("Two-factor authentication</h1>");
  });
});
