import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "./i18n/en.js";
import {
  settingsSectionHeadingId,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
} from "./settings-sections.js";

/**
 * The Settings rail's section list, and the one duplication it cannot avoid (issue 562).
 *
 * `plan/admin-design-contracts.md` §7a puts the active-section mark in `app/globals.css` as
 * `:target` rules, because the fragment that decides it is never sent to a server and the
 * rail has to work with JavaScript disabled. CSS cannot interpolate a list, so each section
 * id is written into the stylesheet by hand - and a rail row whose id the stylesheet does
 * not know is a row that can never be marked current, silently. The first test here is that
 * tripwire: it reads the stylesheet and requires the two id sets to be exactly equal, in
 * both directions, so an added section fails until its rules exist and a removed one fails
 * until its rules go.
 */

const GLOBALS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

/** Every `#id:target` the stylesheet names, deduplicated. */
function targetedIds(): readonly string[] {
  const found = [...GLOBALS.matchAll(/#([a-z][\w-]*):target/gu)].map((match) => match[1] ?? "");
  return [...new Set(found)];
}

describe("the Settings section list", () => {
  it("names exactly the sections `app/globals.css` writes `:target` rules for", () => {
    const declared = SETTINGS_SECTIONS.map((section) => section.id);
    expect(
      [...targetedIds()].sort((a, b) => a.localeCompare(b)),
      "the ids in `lib/settings-sections.ts` and the `:target` rules in `app/globals.css` are one list written twice, and they have drifted",
    ).toEqual([...declared].sort((a, b) => a.localeCompare(b)));
  });

  it("gives every section all three of its rules, so a row can be marked in full", () => {
    // Three families per section, and each is a separate promise: reveal the section's name
    // in the collapsed summary, reveal the visually-hidden "current" phrase in its row, and
    // paint the row's accent edge. A section with two of the three is marked for a sighted
    // reader and not for a screen reader, or the other way round.
    for (const section of SETTINGS_SECTIONS) {
      const uses = GLOBALS.split(`:has(#${section.id}:target)`).length - 1;
      expect(uses, `the ${section.id} section's three \`:target\` rules`).toBeGreaterThanOrEqual(3);
    }
  });

  it("carries three sections with unique ids and real catalog keys", () => {
    // Three, because the screen has three `<h2>`s. The recovery-codes form is an `<h3>`
    // inside the two-factor card and only exists for an enrolled account, so promoting it
    // would give the rail a row that appears and disappears with account state.
    expect(SETTINGS_SECTIONS).toHaveLength(3);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(3);
    for (const section of SETTINGS_SECTIONS) {
      expect(messages[section.labelKey], `the ${section.id} section's name`).toBeTruthy();
    }
  });

  it("keeps the published `#change-password` anchor the account menu links to", () => {
    // `components/account-menu.tsx` links to `/settings#change-password`, and that link is
    // part of that control's contract. Renaming this id for tidiness breaks a working link.
    expect(SETTINGS_SECTION_IDS.changePassword).toBe("change-password");
    expect(SETTINGS_SECTIONS.some((section) => section.id === "change-password")).toBe(true);
  });

  it("derives a heading id that cannot collide with the section's own", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(settingsSectionHeadingId(section.id)).not.toBe(section.id);
    }
  });
});
