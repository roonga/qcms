import { describe, expect, it } from "vitest";

import type { RoutePolicy } from "./route-policy.js";

import {
  workspaceFilterFor,
  workspaceFilterNarrowedTo,
  type GrantContext,
} from "./context.js";

const POLICY = {} as RoutePolicy;

function grant(workspaceIds?: readonly string[]): GrantContext {
  return { policy: POLICY, ...(workspaceIds === undefined ? {} : { workspaceIds }) };
}

describe("workspaceFilterFor", () => {
  it("leaves an installation-wide read unfiltered", () => {
    expect(workspaceFilterFor(grant())).toEqual({});
    expect(workspaceFilterFor(undefined)).toEqual({});
  });

  it("carries the workspaces the caller holds the act in", () => {
    expect(workspaceFilterFor(grant(["org_a", "org_b"]))).toEqual({
      workspaceIds: ["org_a", "org_b"],
    });
  });
});

describe("workspaceFilterNarrowedTo", () => {
  it("falls back to the held set when no workspace is named", () => {
    expect(workspaceFilterNarrowedTo(grant(["org_a", "org_b"]), undefined)).toEqual({
      workspaceIds: ["org_a", "org_b"],
    });
    expect(workspaceFilterNarrowedTo(grant(), undefined)).toEqual({});
  });

  it("narrows to one workspace the caller holds", () => {
    expect(workspaceFilterNarrowedTo(grant(["org_a", "org_b"]), "org_b")).toEqual({
      workspaceIds: ["org_b"],
    });
  });

  it("narrows an installation-wide read to the workspace named", () => {
    expect(workspaceFilterNarrowedTo(grant(), "org_b")).toEqual({ workspaceIds: ["org_b"] });
  });

  it("yields nothing for a workspace the caller holds nothing in", () => {
    expect(workspaceFilterNarrowedTo(grant(["org_a"]), "org_b")).toEqual({ workspaceIds: [] });
  });
});
