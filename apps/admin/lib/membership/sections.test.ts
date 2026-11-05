import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "../i18n/en.ts";

import {
  WORKSPACE_SECTION_LABELS,
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

  it("label each section from the catalog", () => {
    for (const section of WORKSPACE_SECTIONS) {
      expect(messages).toHaveProperty(WORKSPACE_SECTION_LABELS[section]);
    }
  });

  it("land a workspace's own address on its first section, encoding the id", () => {
    expect(workspaceHref("ws_1")).toBe("/workspaces/ws_1/members");
    expect(workspaceSectionHref("a/b", "audit")).toBe("/workspaces/a%2Fb/audit");
  });
});
