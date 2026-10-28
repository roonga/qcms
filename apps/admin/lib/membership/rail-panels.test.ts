import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "../i18n/en.ts";

import { WORKSPACE_RAIL_PANELS } from "./rail-panels.ts";

/**
 * The workspace rail's four fragments resolve to elements that exist.
 *
 * A fragment matching nothing fails silently, and the other end of each pair is a file this
 * rail does not own, so the two strings are compared rather than trusted.
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
    expect(WORKSPACE_RAIL_PANELS.map((panel) => panel.anchor)).toEqual([
      "qcms-members-heading",
      "qcms-access-groups-heading",
      "qcms-workspace-settings-heading",
      "qcms-audit-heading",
    ]);
  });
});
