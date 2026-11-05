import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "../i18n/en.ts";

import {
  WORKSPACE_SECTION_DEFS,
  WORKSPACE_SECTIONS,
  workspaceHref,
  workspaceSectionHref,
} from "./sections.ts";

const APP = fileURLToPath(new URL("../../", import.meta.url));

describe("the workspace sections", () => {
  it("are the five ruled screens, in the rail's order", () => {
    expect(WORKSPACE_SECTIONS).toEqual([
      "members",
      "access-groups",
      "settings",
      "audit",
      "assistant-actions",
    ]);
  });

  it("each have a route page of their own", () => {
    for (const section of WORKSPACE_SECTIONS) {
      const page = `${APP}app/(shell)/workspaces/[workspaceId]/${section}/page.tsx`;
      expect(() => readFileSync(page, "utf8"), `${section} has a page`).not.toThrow();
    }
  });

  it("name a heading id each panel actually renders, labelled from the catalog", () => {
    for (const section of WORKSPACE_SECTIONS) {
      const def = WORKSPACE_SECTION_DEFS[section];
      const source = readFileSync(`${APP}${def.source}`, "utf8");
      expect(source, `${def.source} carries id="${def.headingId}"`).toContain(
        `id="${def.headingId}"`,
      );
      expect(messages).toHaveProperty(def.labelKey);
    }
  });

  it("land a workspace's own address on its first section, encoding the id", () => {
    expect(workspaceHref("ws_1")).toBe("/workspaces/ws_1/members");
    expect(workspaceSectionHref("a/b", "audit")).toBe("/workspaces/a%2Fb/audit");
  });
});
