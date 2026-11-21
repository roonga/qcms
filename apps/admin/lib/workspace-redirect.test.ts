import { describe, expect, it } from "vitest";

import adminNextConfig from "../next.config.ts";

async function workspaceRedirect(): Promise<RegExp> {
  const redirects = (await adminNextConfig("phase-production-build").redirects?.()) ?? [];
  const rule = redirects.find((entry) => entry.destination === "/workspaces/:workspaceId/members");
  const prefix = "/workspaces/:workspaceId(";
  const source = rule?.source ?? "";
  const pattern = source.startsWith(prefix) ? source.slice(prefix.length, -1) : undefined;
  if (pattern === undefined) throw new Error("no workspace landing redirect");
  return new RegExp(`^${pattern}$`, "u");
}

describe("the workspace landing redirect", () => {
  it("sends a workspace id to its Members, and leaves the area screens alone", async () => {
    const segment = await workspaceRedirect();
    expect(segment.test("org_clinical")).toBe(true);
    expect(segment.test("all")).toBe(false);
    expect(segment.test("new")).toBe(false);
    expect(segment.test("newer")).toBe(true);
  });
});
