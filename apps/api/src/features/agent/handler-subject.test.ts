import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScreenBuildInput } from "./contexts/support.js";

const resolved = vi.hoisted(() => ({ workspace: undefined as string | undefined }));
const held = vi.hoisted(() => ({ workspaces: [] as string[] }));

vi.mock("../workspaces/resolve.js", () => ({
  resolveWorkspaceForNewObject: (_exec: unknown, named: string | undefined) => {
    if (named !== undefined) return Promise.resolve(named);
    if (resolved.workspace === undefined) return Promise.reject(new Error("ambiguous"));
    return Promise.resolve(resolved.workspace);
  },
}));

vi.mock("./contexts/support.js", async (original) => ({
  ...(await original<typeof import("./contexts/support.js")>()),
  workspacesHoldingOrNone: () => Promise.resolve(held.workspaces),
}));

const { subjectAllows } = await import("./handler.js");

const build = { deps: { databases: { control: {} } } } as unknown as ScreenBuildInput;
const publishCells = [{ resource: "form", action: "publish" }];

function ask(createdInWorkspace: string | undefined): Promise<boolean> {
  return subjectAllows(build, {
    cells: publishCells,
    environment: "test",
    subject: { createdInWorkspace },
  });
}

describe("a subject an earlier step creates is asked about where that step creates it", () => {
  beforeEach(() => {
    resolved.workspace = undefined;
    held.workspaces = ["wsp_other"];
  });

  it("refuses a create naming no workspace where the installation has several", async () => {
    expect(await ask(undefined)).toBe(false);
  });

  it("asks the installation's only workspace, not any workspace, for a create naming none", async () => {
    resolved.workspace = "wsp_only";
    expect(await ask(undefined)).toBe(false);
    held.workspaces = ["wsp_only"];
    expect(await ask(undefined)).toBe(true);
  });

  it("asks the named workspace", async () => {
    expect(await ask("wsp_named")).toBe(false);
    held.workspaces = ["wsp_named"];
    expect(await ask("wsp_named")).toBe(true);
  });
});
