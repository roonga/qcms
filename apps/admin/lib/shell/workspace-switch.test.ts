import { describe, expect, it } from "vitest";

import { workspaceSwitchTarget } from "./workspace-switch.ts";

function target(pathname: string, search = ""): string {
  return workspaceSwitchTarget({ pathname, search, workspaceId: "org_next" });
}

describe("where a workspace switch lands", () => {
  it("keeps the section it is on inside Workspaces", () => {
    expect(target("/workspaces/org_old/audit")).toBe("/workspaces/org_next/audit");
    expect(target("/workspaces/org_old/members")).toBe("/workspaces/org_next/members");
  });

  it("lands on the first section where the address names none", () => {
    expect(target("/workspaces")).toBe("/workspaces/org_next/members");
    expect(target("/workspaces/all")).toBe("/workspaces/org_next/members");
    expect(target("/workspaces/org_old/not-a-section")).toBe("/workspaces/org_next/members");
  });

  it("lands on the area's list, since an item never exists in two workspaces", () => {
    expect(target("/questions/q_dob")).toBe("/questions");
    expect(target("/questions/new")).toBe("/questions");
    expect(target("/forms/frm_intake/rules")).toBe("/forms");
    expect(target("/forms")).toBe("/forms");
  });

  it("keeps the environment Operations is working in and drops the rest", () => {
    expect(target("/operations", "env=test&q=intake&cursor=c")).toBe("/operations?env=test");
    expect(target("/operations/forms/frm_a/responses", "env=prod")).toBe("/operations?env=prod");
    expect(target("/operations")).toBe("/operations");
    expect(target("/webhooks", "env=test")).toBe("/operations?env=test");
  });

  it("stays where it is on a personal route, which belongs to no area", () => {
    expect(target("/settings")).toBe("/settings");
    expect(target("/me/access")).toBe("/me/access");
  });
});
