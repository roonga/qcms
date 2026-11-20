import { describe, expect, it, vi } from "vitest";

import type { ScreenBuildInput } from "./support.js";

class Refused extends Error {}

vi.mock("./support.js", async (original) => ({
  ...(await original<typeof import("./support.js")>()),
  // A caller who may read the member list and may not administer the workspace.
  requireCell: (_input: unknown, cell: { readonly resource: string; readonly action: string }) =>
    cell.resource === "membership" && cell.action === "read"
      ? Promise.resolve({ memberRole: undefined, grants: [] })
      : Promise.reject(new Refused(`${cell.resource}: ${cell.action}`)),
}));

const { readPorts } = await import("./reads.js");

const input = {
  deps: { databases: { control: {} } },
  principal: { userId: "usr_a", claim: false },
  environment: "test",
  params: {},
} as unknown as ScreenBuildInput;

describe("read_workspace's own check", () => {
  it("refuses a caller holding membership: read without workspace: update", async () => {
    const readWorkspace = readPorts(input).readWorkspace;
    expect(readWorkspace).toBeDefined();
    await expect(readWorkspace?.({ workspaceId: "wsp_a" })).rejects.toThrow(
      new Refused("workspace: update"),
    );
  });
});
