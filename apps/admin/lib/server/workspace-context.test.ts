import { beforeEach, describe, expect, it, vi } from "vitest";

const readMyAccess = vi.fn();
const listWorkspaces = vi.fn();

vi.mock("./membership.ts", () => ({ readMyAccess, listWorkspaces }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { currentWorkspaceContext } = await import("./workspace-context.ts");

const SESSION = {} as never;

function access(installationAdmin: boolean, held: readonly string[]): unknown {
  return {
    ok: true,
    data: {
      installationAdmin,
      workspaces: held.map((workspaceId) => ({ workspaceId, name: workspaceId })),
    },
  };
}

function list(ids: readonly string[]): unknown {
  return { ok: true, data: ids.map((workspaceId) => ({ workspaceId, name: workspaceId })) };
}

beforeEach(() => {
  readMyAccess.mockReset();
  listWorkspaces.mockReset();
});

describe("the workspace switcher's choices", () => {
  it("offers a caller without the claim only the workspaces they hold something in", async () => {
    readMyAccess.mockResolvedValue(access(false, ["org_a"]));
    listWorkspaces.mockResolvedValue(list(["org_a", "org_b"]));

    const context = await currentWorkspaceContext(SESSION);
    expect(context.choices.map((choice) => choice.workspaceId)).toEqual(["org_a"]);
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  it("offers the claim holder the workspace list as the API returns it, and nothing more", async () => {
    readMyAccess.mockResolvedValue(access(true, ["org_a"]));
    listWorkspaces.mockResolvedValue(list(["org_a", "org_c"]));

    const context = await currentWorkspaceContext(SESSION);
    expect(context.choices.map((choice) => choice.workspaceId).sort()).toEqual(["org_a", "org_c"]);
  });

  it("offers no workspace when the access read fails", async () => {
    readMyAccess.mockResolvedValue({ ok: false });

    const context = await currentWorkspaceContext(SESSION);
    expect(context.choices).toEqual([]);
    expect(context.current).toBeUndefined();
  });
});
