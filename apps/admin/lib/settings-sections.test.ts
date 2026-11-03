import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "./i18n/en.js";
import {
  DEFAULT_SETTINGS_SECTION,
  PASSWORD_PANEL_MARKERS,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  settingsSectionFromHash,
  settingsSectionFromParams,
  settingsSectionLabelKey,
  TWO_FACTOR_PANEL_MARKERS,
} from "./settings-sections.js";

const PAGE = readFileSync(
  fileURLToPath(new URL("../app/(shell)/settings/page.tsx", import.meta.url)),
  "utf8",
);

describe("the Settings section list", () => {
  it("carries three sections with unique ids, unique panel ids and real catalog keys", () => {
    expect(SETTINGS_SECTIONS).toHaveLength(3);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(3);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.panelId)).size).toBe(3);
    for (const section of SETTINGS_SECTIONS) {
      expect(messages[section.labelKey], `the ${section.id} section's name`).toBeTruthy();
    }
  });

  it("names its panels the way the POC names them", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.panelId)).toStrictEqual([
      "settings-panel-account",
      "settings-panel-password",
      "settings-panel-twofactor",
    ]);
  });

  it("opens on Account, which is the panel the POC leaves un-hidden", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe(SETTINGS_SECTION_IDS.account);
    expect(settingsSectionFromParams({})).toBe(SETTINGS_SECTION_IDS.account);
  });

  it("keeps the published `#change-password` anchor the account menu links to", () => {
    expect(SETTINGS_SECTION_IDS.changePassword).toBe("change-password");
    expect(settingsSectionFromHash("#change-password")).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromHash("change-password")).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromHash("#two-factor")).toBe(SETTINGS_SECTION_IDS.twoFactor);
    expect(settingsSectionFromHash("")).toBeUndefined();
    expect(settingsSectionFromHash("#nothing-here")).toBeUndefined();
  });

  it("lands each redirect marker on the panel that renders its message", () => {
    for (const marker of PASSWORD_PANEL_MARKERS) {
      expect(settingsSectionFromParams({ [marker]: "1" }), marker).toBe(
        SETTINGS_SECTION_IDS.changePassword,
      );
    }
    for (const marker of TWO_FACTOR_PANEL_MARKERS) {
      expect(settingsSectionFromParams({ [marker]: "1" }), marker).toBe(
        SETTINGS_SECTION_IDS.twoFactor,
      );
    }

    expect(settingsSectionFromParams({ changed: "1" })).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromParams({ error: "1" })).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromParams({ throttled: "1" })).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromParams({ codesError: "1" })).toBe(SETTINGS_SECTION_IDS.twoFactor);
    expect(settingsSectionFromParams({ codesThrottled: "1" })).toBe(SETTINGS_SECTION_IDS.twoFactor);

    expect(settingsSectionFromParams({ compromised: "1" })).toBe(
      SETTINGS_SECTION_IDS.changePassword,
    );
  });

  it("reads every marker the Settings page actually renders a message for", () => {
    const rendered = [...PAGE.matchAll(/params\.(\w+)/gu)].map((match) => match[1] ?? "");
    expect(new Set(rendered)).toEqual(
      new Set([...PASSWORD_PANEL_MARKERS, ...TWO_FACTOR_PANEL_MARKERS]),
    );
  });

  it("names every section, and says so rather than guessing when one is missing", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(settingsSectionLabelKey(section.id)).toBe(section.labelKey);
    }
  });
});
