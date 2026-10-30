import { describe, expect, it } from "vitest";

import {
  NO_CONTEXT,
  parseWorkspaceContext,
  restoredModePath,
  restoredWorkspacePath,
  shellModeCookie,
} from "./context.ts";
import {
  AUTHORING_PATH,
  declaredMode,
  exitMode,
  focusedMode,
  isPersonalRoute,
  landingArea,
  landingPath,
  modeForPath,
  MY_ACCESS_PATH,
  NO_CAPABILITIES,
  OPERATIONS_PATH,
  parseShellMode,
  permitsMode,
  permitsPath,
  permittedAreas,
  rememberableMode,
  SETTINGS_PATH,
  WORKSPACES_PATH,
  type ShellCapabilities,
} from "./modes.ts";

function capabilities(partial: Partial<ShellCapabilities>): ShellCapabilities {
  return { ...NO_CAPABILITIES, ...partial };
}

const EVERYTHING = capabilities({
  authoring: true,
  operations: true,
  workspaces: true,
  siteConfiguration: true,
});

describe("the route table resolves the mode", () => {
  it("reads the mode off the route rather than off a menu", () => {
    expect(declaredMode("/questions")).toBe("normal");
    expect(declaredMode("/questions/q_1")).toBe("normal");
    expect(declaredMode("/forms/frm_1/rules")).toBe("normal");
    expect(declaredMode(OPERATIONS_PATH)).toBe("operations");
    expect(declaredMode("/operations/forms")).toBe("operations");
    expect(declaredMode(WORKSPACES_PATH)).toBe("workspaces");
    expect(declaredMode("/workspaces/ws_1")).toBe("workspaces");
  });

  it("keeps the form subtree in normal mode until the operational phase moves it", () => {
    expect(declaredMode("/forms/frm_1/responses")).toBe("normal");
    expect(declaredMode("/forms/frm_1/links")).toBe("normal");
    expect(declaredMode("/forms/frm_1/webhooks")).toBe("normal");
  });

  it("puts the global queues and the legacy picker in Operations", () => {
    expect(declaredMode("/webhooks")).toBe("operations");
    expect(declaredMode("/responses")).toBe("operations");
    expect(declaredMode("/responses/erasures")).toBe("operations");
  });

  it("matches a whole segment, so a longer name cannot borrow a mode", () => {
    expect(declaredMode("/operationsomething")).toBeUndefined();
    expect(declaredMode("/workspacesomething")).toBeUndefined();
  });

  it("declares no mode for a personal route", () => {
    expect(isPersonalRoute("/settings")).toBe(true);
    expect(isPersonalRoute("/settings/password")).toBe(true);
    expect(isPersonalRoute(MY_ACCESS_PATH)).toBe(true);
    expect(declaredMode("/settings")).toBeUndefined();
    expect(declaredMode(MY_ACCESS_PATH)).toBeUndefined();
  });

  it("falls to normal for a route no mode claims", () => {
    expect(modeForPath("/nowhere", undefined)).toBe("normal");
  });
});

describe("a personal route stays inside the focused mode it was opened from", () => {
  it("keeps Operations while account settings are open", () => {
    expect(modeForPath("/settings", "operations")).toBe("operations");
    expect(modeForPath(MY_ACCESS_PATH, "operations")).toBe("operations");
  });

  it("keeps Workspaces while account settings are open", () => {
    expect(modeForPath("/settings/password", "workspaces")).toBe("workspaces");
  });

  it("is normal with nothing remembered", () => {
    expect(modeForPath("/settings", undefined)).toBe("normal");
  });

  it("is normal when normal is what was remembered, so a focused mode cannot linger", () => {
    expect(modeForPath("/settings", "normal")).toBe("normal");
    expect(modeForPath("/me/access", "normal")).toBe("normal");
  });

  it("never lets a remembered mode override the route's own", () => {
    expect(modeForPath("/questions", "operations")).toBe("normal");
    expect(modeForPath(OPERATIONS_PATH, "workspaces")).toBe("operations");
  });

  it("discards a cookie that is not a mode", () => {
    expect(parseShellMode("operations")).toBe("operations");
    expect(parseShellMode("nonsense")).toBeUndefined();
    expect(parseShellMode(undefined)).toBeUndefined();
    expect(modeForPath("/settings", parseShellMode("nonsense"))).toBe("normal");
  });
});

describe("which modes hide the normal menus", () => {
  it("focuses both dedicated modes and neither of normal's routes", () => {
    expect(focusedMode("operations")).toBe("operations");
    expect(focusedMode("workspaces")).toBe("workspaces");
    expect(focusedMode("normal")).toBeUndefined();
  });
});

describe("landing rules", () => {
  it("lands an authoring caller in the authoring area", () => {
    expect(landingPath(EVERYTHING)).toBe(AUTHORING_PATH);
    expect(landingPath(capabilities({ authoring: true }))).toBe(AUTHORING_PATH);
  });

  it("lands an Operations-only caller in Operations", () => {
    expect(landingPath(capabilities({ operations: true }))).toBe(OPERATIONS_PATH);
  });

  it("lands a workspace-only manager in Workspaces", () => {
    expect(landingPath(capabilities({ workspaces: true }))).toBe(WORKSPACES_PATH);
  });

  it("lands a caller with no grant on My access rather than fabricating authoring", () => {
    expect(landingPath(NO_CAPABILITIES)).toBe(MY_ACCESS_PATH);
    expect(landingPath(capabilities({ siteConfiguration: true }))).toBe(MY_ACCESS_PATH);
  });

  it("names the area rather than a path, so a remembered context can be restored", () => {
    expect(landingArea(EVERYTHING)).toBe("normal");
    expect(landingArea(capabilities({ operations: true }))).toBe("operations");
    expect(landingArea(capabilities({ workspaces: true }))).toBe("workspaces");
    expect(landingArea(NO_CAPABILITIES)).toBeUndefined();
  });

  it("never lands on the resolver itself", () => {
    for (const held of [EVERYTHING, NO_CAPABILITIES, capabilities({ operations: true })]) {
      expect(landingPath(held)).not.toBe("/");
    }
  });
});

describe("Exit exists only when there is somewhere else", () => {
  it("offers an authoring caller the way out of both focused modes", () => {
    expect(exitMode("operations", EVERYTHING)).toBe("normal");
    expect(exitMode("workspaces", EVERYTHING)).toBe("normal");
  });

  it("offers no Exit to an Operations-only caller", () => {
    expect(exitMode("operations", capabilities({ operations: true }))).toBeUndefined();
  });

  it("offers no Exit to a workspace-only manager", () => {
    expect(exitMode("workspaces", capabilities({ workspaces: true }))).toBeUndefined();
  });

  it("offers the other focused mode when that is the only other area", () => {
    const both = capabilities({ operations: true, workspaces: true });
    expect(exitMode("operations", both)).toBe("workspaces");
    expect(exitMode("workspaces", both)).toBe("operations");
  });

  it("offers nothing to a caller holding no area at all", () => {
    expect(exitMode("operations", NO_CAPABILITIES)).toBeUndefined();
    expect(permittedAreas(NO_CAPABILITIES)).toEqual([]);
  });

  it("restores the remembered workspace when Exit leads there", () => {
    const both = capabilities({ operations: true, workspaces: true });
    const leavingFor = exitMode("operations", both);
    expect(leavingFor).toBe("workspaces");
    expect(
      restoredModePath("workspaces", { workspace: "ws_1", permittedWorkspaceIds: ["ws_1"] }),
    ).toBe("/workspaces/ws_1");
  });
});

describe("which routes a capability admits", () => {
  it("gates a focused mode on its own capability", () => {
    expect(permitsMode(capabilities({ operations: true }), "operations")).toBe(true);
    expect(permitsMode(capabilities({ workspaces: true }), "operations")).toBe(false);
    expect(permitsPath(capabilities({ operations: true }), "/operations")).toBe(true);
    expect(permitsPath(NO_CAPABILITIES, "/operations")).toBe(false);
    expect(permitsPath(NO_CAPABILITIES, "/workspaces/ws_1")).toBe(false);
  });

  it("admits the installation claim to Operations, whose global queues are its own", () => {
    const claim = capabilities({ siteConfiguration: true });
    expect(permitsMode(claim, "operations")).toBe(true);
    expect(permitsPath(claim, OPERATIONS_PATH)).toBe(true);
    expect(permitsPath(claim, "/webhooks")).toBe(true);
    expect(permitsPath(claim, "/responses/erasures")).toBe(true);
  });

  it("does not land the claim in Operations, where it discovers no form", () => {
    const claim = capabilities({ siteConfiguration: true, workspaces: true });
    expect(permittedAreas(claim)).toEqual(["workspaces"]);
    expect(landingPath(claim)).toBe(WORKSPACES_PATH);
    expect(exitMode("operations", claim)).toBe("workspaces");
  });

  it("refuses the queues to a caller holding neither cell nor claim", () => {
    expect(permitsPath(NO_CAPABILITIES, "/webhooks")).toBe(false);
    expect(permitsPath(NO_CAPABILITIES, "/responses")).toBe(false);
  });

  it("remembers only a mode the caller may enter, and never a personal route", () => {
    const authoring = capabilities({ authoring: true });
    expect(rememberableMode("/questions", authoring)).toBe("normal");
    expect(rememberableMode(OPERATIONS_PATH, capabilities({ operations: true }))).toBe(
      "operations",
    );
    // A refused mode is not remembered, or a denied bookmark would decide where this
    // caller's next personal route sits.
    expect(rememberableMode(OPERATIONS_PATH, authoring)).toBeUndefined();
    expect(rememberableMode("/webhooks", authoring)).toBeUndefined();
    expect(rememberableMode(WORKSPACES_PATH, authoring)).toBeUndefined();
    expect(rememberableMode(SETTINGS_PATH, EVERYTHING)).toBeUndefined();
    expect(rememberableMode(MY_ACCESS_PATH, EVERYTHING)).toBeUndefined();
  });

  it("gates no normal or personal route, which decide on the server for themselves", () => {
    expect(permitsPath(NO_CAPABILITIES, "/questions")).toBe(true);
    expect(permitsPath(NO_CAPABILITIES, "/forms/frm_1/responses")).toBe(true);
    expect(permitsPath(NO_CAPABILITIES, "/settings")).toBe(true);
    expect(permitsPath(NO_CAPABILITIES, MY_ACCESS_PATH)).toBe(true);
  });

  it("admits normal mode to anyone, since it is not an area a caller is let into", () => {
    expect(permitsMode(NO_CAPABILITIES, "normal")).toBe(true);
  });
});

describe("what a mode remembers", () => {
  it("restores a remembered workspace only while the caller still administers it", () => {
    expect(restoredWorkspacePath("ws_1", ["ws_1", "ws_2"])).toBe("/workspaces/ws_1");
    expect(restoredWorkspacePath("ws_1", ["ws_2"])).toBe(WORKSPACES_PATH);
    expect(restoredWorkspacePath("ws_1", [])).toBe(WORKSPACES_PATH);
    expect(restoredWorkspacePath(undefined, ["ws_1"])).toBe(WORKSPACES_PATH);
  });

  it("returns Operations to its forms list rather than to a remembered form", () => {
    expect(restoredModePath("operations", NO_CONTEXT)).toBe(OPERATIONS_PATH);
    expect(
      restoredModePath("operations", { workspace: "ws_1", permittedWorkspaceIds: ["ws_1"] }),
    ).toBe(OPERATIONS_PATH);
  });

  it("restores the Workspaces mode through the permitted set", () => {
    expect(
      restoredModePath("workspaces", { workspace: "ws_1", permittedWorkspaceIds: ["ws_1"] }),
    ).toBe("/workspaces/ws_1");
    expect(restoredModePath("workspaces", { workspace: "ws_1", permittedWorkspaceIds: [] })).toBe(
      WORKSPACES_PATH,
    );
    expect(restoredModePath("workspaces", NO_CONTEXT)).toBe(WORKSPACES_PATH);
  });

  it("escapes a remembered identifier into the path", () => {
    expect(restoredWorkspacePath("ws.a-1", ["ws.a-1"])).toBe("/workspaces/ws.a-1");
  });

  it("discards a remembered value that is not an identifier", () => {
    expect(parseWorkspaceContext("ws_1")).toBe("ws_1");
    expect(parseWorkspaceContext("")).toBeUndefined();
    expect(parseWorkspaceContext(undefined)).toBeUndefined();
    expect(parseWorkspaceContext("../../etc")).toBeUndefined();
    expect(parseWorkspaceContext("ws 1")).toBeUndefined();
    expect(parseWorkspaceContext("w".repeat(65))).toBeUndefined();
  });

  it("writes the mode cookie as presentation chrome, Secure only where asked", () => {
    expect(shellModeCookie("operations", true)).toContain("qcms-shell-mode=operations");
    expect(shellModeCookie("operations", true)).toContain("SameSite=Lax");
    expect(shellModeCookie("operations", true)).toContain("Secure");
    expect(shellModeCookie("operations", false)).not.toContain("Secure");
    expect(shellModeCookie("operations", false)).not.toContain("HttpOnly");
  });
});
