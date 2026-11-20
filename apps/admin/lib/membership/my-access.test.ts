import { describe, expect, it } from "vitest";

import { NO_CAPABILITIES } from "../shell/modes.ts";

import { explanationEnvironments, heldGroups, holdsNoAccess } from "./my-access.ts";
import type { MyAccess, MyAccessWorkspace } from "./types.ts";

function workspace(overrides: Partial<MyAccessWorkspace> = {}): MyAccessWorkspace {
  return {
    workspaceId: "org_1",
    slug: "clinical",
    name: "Clinical",
    archived: false,
    memberRole: "member",
    grants: [],
    environments: [],
    ...overrides,
  };
}

function access(overrides: Partial<MyAccess> = {}): MyAccess {
  return {
    userId: "usr_1",
    installationAdmin: false,
    capabilities: NO_CAPABILITIES,
    workspaces: [],
    siteAdministrators: [],
    multipleWorkspaces: false,
    ...overrides,
  };
}

const AUTHORS = { name: "Authors", roles: ["forms.editor"], environments: [] };

describe("holdsNoAccess", () => {
  it("is true for an account with no workspace, and for a member of one with no group", () => {
    expect(holdsNoAccess(access())).toBe(true);
    expect(holdsNoAccess(access({ workspaces: [workspace()] }))).toBe(true);
  });

  it("is false for a Site administrator, a Workspace administrator, or anyone in a group", () => {
    expect(holdsNoAccess(access({ installationAdmin: true }))).toBe(false);
    expect(holdsNoAccess(access({ workspaces: [workspace({ memberRole: "forms.owner" })] }))).toBe(
      false,
    );
    expect(
      holdsNoAccess(access({ workspaces: [workspace(), workspace({ grants: [AUTHORS] })] })),
    ).toBe(false);
  });
});

describe("heldGroups", () => {
  it("expands a group that names no environment to every column, and keeps a named set", () => {
    const groups = heldGroups(
      workspace({
        grants: [
          AUTHORS,
          { name: "Publishers", roles: ["forms.publisher"], environments: ["prod"] },
        ],
      }),
      ["test", "prod"],
    );
    expect(groups).toStrictEqual([
      { id: "Authors", name: "Authors", roles: ["forms.editor"], environments: ["test", "prod"] },
      { id: "Publishers", name: "Publishers", roles: ["forms.publisher"], environments: ["prod"] },
    ]);
  });
});

describe("explanationEnvironments", () => {
  it("prefers the set the API reported, in its order", () => {
    expect(explanationEnvironments(access(), ["test", "prod"])).toStrictEqual(["test", "prod"]);
  });

  it("falls back to every environment held anywhere, once each, when that read failed", () => {
    const mine = access({
      workspaces: [
        workspace({ environments: ["test"] }),
        workspace({ workspaceId: "org_2", environments: ["test", "prod"] }),
      ],
    });
    expect(explanationEnvironments(mine, undefined)).toStrictEqual(["test", "prod"]);
  });
});
