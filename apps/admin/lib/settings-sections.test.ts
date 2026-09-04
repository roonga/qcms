import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "./i18n/en.js";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  settingsSectionFromHash,
  settingsSectionFromParams,
  settingsSectionLabelKey,
} from "./settings-sections.js";

/**
 * The Settings section list, and the URL contracts that decide which panel opens (issue 655).
 *
 * The switch itself is three renders of one value and needs a browser to be worth asserting
 * (`apps/admin/e2e/settings-rail.pw.ts`). What is checkable here is the list every side reads
 * and the two pure functions that turn a URL into a section: a redirect marker landing on the
 * wrong panel would hide the message it came back to show, silently and only after a POST.
 */

const PAGE = readFileSync(
  fileURLToPath(new URL("../app/(shell)/settings/page.tsx", import.meta.url)),
  "utf8",
);

describe("the Settings section list", () => {
  it("carries three sections with unique ids, unique panel ids and real catalog keys", () => {
    // Three, because the screen has three panels. The recovery-codes form is a subheading
    // inside the two-factor panel and only exists for an enrolled account, so promoting it
    // would give the rail a row that appears and disappears with account state.
    expect(SETTINGS_SECTIONS).toHaveLength(3);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(3);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.panelId)).size).toBe(3);
    for (const section of SETTINGS_SECTIONS) {
      expect(messages[section.labelKey], `the ${section.id} section's name`).toBeTruthy();
    }
  });

  it("names its panels the way the POC names them", () => {
    // `plan/admin-shell-poc/settings-newquestion-poc.html` writes these three ids out, and
    // two of them are NOT the section id with a prefix: the POC's panel names were written
    // fresh while `change-password` and `two-factor` carry the URL history below.
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
    // `components/account-menu.tsx` links to `/settings#change-password`, and that link is
    // part of that control's contract. Under the stacked screen the fragment scrolled; under
    // the panel screen it selects. Renaming this id for tidiness breaks a working link.
    expect(SETTINGS_SECTION_IDS.changePassword).toBe("change-password");
    expect(settingsSectionFromHash("#change-password")).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromHash("change-password")).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromHash("#two-factor")).toBe(SETTINGS_SECTION_IDS.twoFactor);
    expect(settingsSectionFromHash("")).toBeUndefined();
    expect(settingsSectionFromHash("#nothing-here")).toBeUndefined();
  });

  it("lands each redirect marker on the panel that renders its message", () => {
    // The failure this rules out is invisible until it happens to someone: a password change
    // that confirms itself inside a hidden panel reads as a change that did not take.
    expect(settingsSectionFromParams({ changed: "1" })).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromParams({ error: "1" })).toBe(SETTINGS_SECTION_IDS.changePassword);
    expect(settingsSectionFromParams({ codesError: "1" })).toBe(SETTINGS_SECTION_IDS.twoFactor);
    // The breached-password refusal (issue #437). A message an operator never sees is the
    // exact defect that issue exists to close, so routing it is part of the fix rather
    // than a detail of it.
    expect(settingsSectionFromParams({ compromised: "1" })).toBe(
      SETTINGS_SECTION_IDS.changePassword,
    );
  });

  it("reads every marker the Settings page actually renders a message for", () => {
    // The tripwire, because the two sides are one list written twice: a fifth marker added
    // to the page renders a message on whatever panel happened to be open until it is routed
    // here too. Read off the page's source rather than restated, so it cannot be forgotten.
    // It has already caught one: `compromised` arrived with issue #437 and failed here.
    const rendered = [...PAGE.matchAll(/params\.(\w+) !== undefined/gu)].map(
      (match) => match[1] ?? "",
    );
    expect(new Set(rendered)).toEqual(new Set(["changed", "error", "compromised", "codesError"]));
  });

  it("names every section, and says so rather than guessing when one is missing", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(settingsSectionLabelKey(section.id)).toBe(section.labelKey);
    }
  });
});
