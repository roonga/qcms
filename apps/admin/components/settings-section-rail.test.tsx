import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SETTINGS_SECTION_IDS, SETTINGS_SECTIONS } from "../lib/settings-sections.ts";
import type { SettingsSectionId } from "../lib/settings-sections.ts";

async function render(initial: SettingsSectionId = SETTINGS_SECTION_IDS.account): Promise<string> {
  const { SettingsSectionRail } = await import("./settings-section-rail.tsx");
  return renderToStaticMarkup(<SettingsSectionRail initial={initial} />);
}

describe("the Settings rail's markup", () => {
  it("is a complementary landmark named for its subject, holding the sections nav", async () => {
    const html = await render();
    expect(html).toContain('<aside id="qcms-rail-region" class="qcms-rail" aria-label="Settings"');
    expect(html).toContain('<nav aria-label="Settings sections">');
    expect(html).toContain('data-testid="qcms-settings-rail"');
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
    expect(html.slice(html.indexOf("<details"))).not.toContain("<button");
  });

  it("marks exactly one row current, and it is the section the screen opened with", async () => {
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(1);
    const marked = /<a [^>]*aria-current="page"[^>]*>/u.exec(html)?.[0] ?? "";
    expect(marked).toContain('id="rail-settings-panel-twofactor"');
    expect(marked).toContain('aria-controls="settings-panel-twofactor"');
  });

  it("repeats neither the screen nor the active section in the Header, and offers no way back", async () => {
    const html = await render(SETTINGS_SECTION_IDS.twoFactor);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("qcms-rail__summary--area");
    expect(summary).not.toContain("Settings");
    expect(summary).not.toContain("Two-factor authentication");
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
    expect(html).not.toContain("qcms-tag");
    expect(html).not.toContain("qcms-rail__actions");
    expect([...html.matchAll(/<ul /gu)]).toHaveLength(1);
  });

  it("holds no heading, so it cannot break heading order on the screen below it", async () => {
    const html = await render();
    expect(html).not.toMatch(/<h[1-6][\s>]/u);
  });

  it("collapses into a native details, open, so the disclosure needs no script", async () => {
    const html = await render();
    expect(html).toContain('<details class="qcms-rail__disclosure" open=""');
    expect(html).toContain('<summary class="qcms-rail__summary qcms-rail__summary--area">');
  });

  it("reaches for no router, because a fragment is not a route", () => {
    const here = fileURLToPath(import.meta.url);
    const source = readFileSync(join(dirname(here), "settings-section-rail.tsx"), "utf8");
    expect(source).not.toContain('from "next/link"');
    const imports = source.split("\n").filter((line) => line.startsWith("import"));
    expect(imports.some((line) => line.includes("rail-frame"))).toBe(true);
    expect(imports.some((line) => line.includes("rail-disclosure"))).toBe(false);
  });
});
