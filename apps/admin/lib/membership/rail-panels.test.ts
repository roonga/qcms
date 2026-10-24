import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "../i18n/en.ts";

import { WORKSPACE_RAIL_PANELS } from "./rail-panels.ts";

/**
 * The workspace rail's four fragments resolve to four elements that exist (issue #1117).
 *
 * ## Why this gate rather than a rendered assertion
 *
 * A fragment that matches nothing fails SILENTLY: the browser scrolls nowhere and reports
 * nothing, so a rail row whose id has been renamed in the panel beside it looks like a row
 * that simply does not work and nothing goes red. The two ends of the equality are in
 * different files and only one of them is this rail's, which makes renaming the other end a
 * perfectly reasonable edit for somebody who has never read the rail.
 *
 * Rendering the four panels together would be the other way to check it, and it would cost
 * four sets of fixture props and four `vi.mock` registrations for server actions none of
 * this is about. The subject here is a pair of strings.
 *
 * The labels are checked against the catalog in the same pass, because a row with a key the
 * catalog has lost would render the key itself - visible, but only to somebody who opened
 * the screen.
 */

const APP = fileURLToPath(new URL("../../", import.meta.url));

describe("the workspace rail's sections", () => {
  it("names a heading id each panel actually renders", () => {
    for (const panel of WORKSPACE_RAIL_PANELS) {
      const source = readFileSync(`${APP}${panel.source}`, "utf8");
      expect(source, `${panel.source} carries id="${panel.anchor}"`).toContain(
        `id="${panel.anchor}"`,
      );
    }
  });

  it("labels each row with a catalog key, so no row renders its own key", () => {
    for (const panel of WORKSPACE_RAIL_PANELS) {
      expect(messages, `the catalog has ${panel.labelKey}`).toHaveProperty(panel.labelKey);
    }
  });

  it("lists the four panels the ruled table names, in the page's own order", () => {
    // §7.0's table: "Members, Access groups, Workspace settings, Access audit". Restated
    // rather than derived, so a fifth panel is a change somebody reviews against the table
    // rather than a row that appears because a file was added.
    expect(WORKSPACE_RAIL_PANELS.map((panel) => panel.anchor)).toEqual([
      "qcms-members-heading",
      "qcms-access-groups-heading",
      "qcms-workspace-settings-heading",
      "qcms-audit-heading",
    ]);
  });
});
