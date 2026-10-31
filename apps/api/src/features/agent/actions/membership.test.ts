import { describe, expect, it } from "vitest";

import { policyForRequest } from "../../membership/route-policy.js";
import {
  createAccessGroup,
  grantAccessGroup,
  removeAccessGroup,
  revokeAccessGroup,
  saveWorkspaceSettings,
  setMemberRole,
} from "./membership.js";
import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * D8's six kinds. The properties that matter per kind are the same two as everywhere: the
 * arguments the card displays are the arguments recomputed from the request, and the route
 * the descriptor names is the one the policy table authorises with the same cell.
 */

const DEFS: readonly ActionKindDef[] = [
  createAccessGroup,
  removeAccessGroup,
  grantAccessGroup,
  revokeAccessGroup,
  setMemberRole,
  saveWorkspaceSettings,
];

function factsFor(def: ActionKindDef, body: unknown): ActionRequestFacts {
  return {
    path: def.route.path,
    method: def.route.method,
    params: { id: "wsp_a", teamId: "grp_a", userId: "usr_a" },
    body,
    environment: "test",
  };
}

describe("D8's action kinds", () => {
  it("names a route the policy table authorises, with the same cell", () => {
    for (const def of DEFS) {
      const policy = policyForRequest(def.route.method, def.route.path);
      expect(policy?.path, def.kind).toBe(def.route.path);
      expect({ resource: policy?.resource, action: policy?.action }, def.kind).toEqual(def.cell);
    }
  });

  it("acts in no environment of its own, so the switcher's is what a step binds", () => {
    for (const def of DEFS) {
      expect(def.environmentFrom, def.kind).toBe("switcher");
      expect(def.environmentArgument, def.kind).toBeUndefined();
      expect(policyForRequest(def.route.method, def.route.path)?.environmentFrom, def.kind).toBe(
        undefined,
      );
    }
  });

  it("sits on the workspace screen and names a heading-row control", () => {
    for (const def of DEFS) {
      expect(def.screen, def.kind).toBe("/workspaces/[workspaceId]");
      expect(def.card.headingControl, def.kind).not.toBeUndefined();
    }
  });

  it("recomputes a group create from the body the card displayed", () => {
    const body = {
      name: "test.responses.viewer.ops",
      role: "responses.viewer",
      label: "ops",
      environments: ["test"],
      forms: ["all"],
    };
    expect(createAccessGroup.recomputeArgs(factsFor(createAccessGroup, body))).toEqual({
      workspaceId: "wsp_a",
      name: "test.responses.viewer.ops",
      role: "responses.viewer",
      label: "ops",
      environments: ["test"],
      forms: ["all"],
    });
    expect(
      createAccessGroup.recomputeArgs(
        factsFor(createAccessGroup, { ...body, label: undefined, name: "test.responses.viewer" }),
      ),
    ).toEqual({
      workspaceId: "wsp_a",
      name: "test.responses.viewer",
      role: "responses.viewer",
      environments: ["test"],
      forms: ["all"],
    });
  });

  it("recomputes the path-only kinds from the path alone", () => {
    expect(removeAccessGroup.recomputeArgs(factsFor(removeAccessGroup, undefined))).toEqual({
      workspaceId: "wsp_a",
      teamId: "grp_a",
    });
    expect(revokeAccessGroup.recomputeArgs(factsFor(revokeAccessGroup, undefined))).toEqual({
      workspaceId: "wsp_a",
      teamId: "grp_a",
      userId: "usr_a",
    });
  });

  it("recomputes a grant and a member role from the one body member each carries", () => {
    expect(
      grantAccessGroup.recomputeArgs(factsFor(grantAccessGroup, { email: "a@qcms.test" })),
    ).toEqual({ workspaceId: "wsp_a", teamId: "grp_a", email: "a@qcms.test" });
    expect(setMemberRole.recomputeArgs(factsFor(setMemberRole, { role: "forms.owner" }))).toEqual({
      workspaceId: "wsp_a",
      userId: "usr_a",
      role: "forms.owner",
    });
  });

  it("omits a workspace switch the request left alone, so the digest covers what was shown", () => {
    expect(
      saveWorkspaceSettings.recomputeArgs(
        factsFor(saveWorkspaceSettings, { requireSecondApprover: true }),
      ),
    ).toEqual({ workspaceId: "wsp_a", requireSecondApprover: true });
    expect(
      saveWorkspaceSettings.recomputeArgs(
        factsFor(saveWorkspaceSettings, { seedNewEditorsWithTestData: false }),
      ),
    ).toEqual({ workspaceId: "wsp_a", seedNewEditorsWithTestData: false });
  });

  it("refuses an argument set with an unknown member or a role outside the two", () => {
    expect(setMemberRole.args.safeParse({ workspaceId: "wsp_a", userId: "usr_a" }).success).toBe(
      false,
    );
    expect(
      setMemberRole.args.safeParse({
        workspaceId: "wsp_a",
        userId: "usr_a",
        role: "forms.editor",
      }).success,
    ).toBe(false);
    expect(
      saveWorkspaceSettings.args.safeParse({ workspaceId: "wsp_a", other: true }).success,
    ).toBe(false);
  });

  it("allowlists no address and no audit detail back to the model", () => {
    for (const def of DEFS) {
      expect(def.resultAllowlist, def.kind).not.toContain("email");
      expect(def.resultAllowlist, def.kind).not.toContain("detail");
    }
  });
});
