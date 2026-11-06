import { describe, expect, it } from "vitest";

import {
  offersWorkspaceChoice,
  workspaceChoicesByName,
  workspaceContextFor,
  type WorkspaceChoice,
} from "./workspace-context.ts";

const ALPHA: WorkspaceChoice = { workspaceId: "org_a", name: "Alpha" };
const BETA: WorkspaceChoice = { workspaceId: "org_b", name: "Beta" };
const ZULU: WorkspaceChoice = { workspaceId: "org_z", name: "Zulu" };

describe("workspaceChoicesByName", () => {
  it("orders by name, and by id where two share one", () => {
    expect(
      workspaceChoicesByName([ZULU, { workspaceId: "org_a2", name: "Alpha" }, ALPHA, BETA]).map(
        (choice) => choice.workspaceId,
      ),
    ).toEqual(["org_a", "org_a2", "org_b", "org_z"]);
  });
});

describe("workspaceContextFor", () => {
  it("keeps the remembered workspace when the caller may still open it", () => {
    expect(workspaceContextFor("org_z", [ALPHA, BETA, ZULU]).current).toEqual(ZULU);
  });

  it("falls back to the first by name for a fresh browser", () => {
    expect(workspaceContextFor(undefined, [ZULU, BETA, ALPHA]).current).toEqual(ALPHA);
  });

  it("discards a remembered workspace the caller can no longer open", () => {
    expect(workspaceContextFor("org_gone", [ZULU, ALPHA]).current).toEqual(ALPHA);
  });

  it("has no current workspace when the caller may open none", () => {
    expect(workspaceContextFor("org_a", [])).toEqual({ choices: [], current: undefined });
  });

  it("offers the switcher only where there is a choice to make", () => {
    expect(offersWorkspaceChoice(workspaceContextFor(undefined, []))).toBe(false);
    expect(offersWorkspaceChoice(workspaceContextFor(undefined, [ALPHA]))).toBe(false);
    expect(offersWorkspaceChoice(workspaceContextFor(undefined, [ALPHA, BETA]))).toBe(true);
  });
});
