import { beforeEach, describe, expect, it, vi } from "vitest";

let status = 200;
let body: unknown = {};

const adminApiFetch = vi.fn<(session: unknown, path: string, init?: unknown) => Promise<Response>>(
  () =>
    Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
    ),
);

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION: Parameters<typeof import("./membership.ts").updateAccessGroup>[0] = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

const GROUP = {
  teamId: "tm_1",
  name: "Authors",
  roles: ["forms.editor", "responses.viewer"],
  environments: ["test"],
  externalGroupId: null,
  holders: [
    { userId: "u_2", email: "b@example.test", suspended: true },
    { userId: "u_3", email: "c@example.test" },
  ],
};

beforeEach(() => {
  adminApiFetch.mockClear();
  status = 200;
  body = {};
});

describe("the access group write clients", () => {
  it("sends the whole group on PUT and reads each holder's suspension", async () => {
    body = { group: GROUP };
    const { updateAccessGroup } = await import("./membership.ts");
    const result = await updateAccessGroup(SESSION, "org a", "tm_1", {
      name: "Authors",
      roles: ["forms.editor", "responses.viewer"],
      environments: ["test"],
    });
    expect(adminApiFetch.mock.calls[0]?.[1]).toBe("/workspaces/org%20a/access-groups/tm_1");
    expect(adminApiFetch.mock.calls[0]?.[2]).toMatchObject({
      method: "PUT",
      body: {
        name: "Authors",
        roles: ["forms.editor", "responses.viewer"],
        environments: ["test"],
      },
    });
    if (!result.ok) throw new Error("expected the update to succeed");
    expect(result.data.holders.map((holder) => holder.suspended)).toEqual([true, false]);
  });

  it("reads a 202 as held, with the group as it still stands", async () => {
    status = 202;
    body = { group: GROUP, request: { requestId: "apr_1" } };
    const { addHolder, updateAccessGroup } = await import("./membership.ts");
    const granted = await addHolder(SESSION, "org_a", "tm_1", "me@example.test");
    const changed = await updateAccessGroup(SESSION, "org_a", "tm_1", {
      name: "Authors",
      roles: ["responses.viewer"],
      environments: ["prod"],
    });
    for (const result of [granted, changed]) {
      expect(result).toMatchObject({ ok: true, held: true, data: { name: "Authors" } });
    }
  });

  it("reads a 200 as done, never as held", async () => {
    body = { group: GROUP };
    const { addHolder, updateAccessGroup } = await import("./membership.ts");
    const granted = await addHolder(SESSION, "org_a", "tm_1", "me@example.test");
    const changed = await updateAccessGroup(SESSION, "org_a", "tm_1", {
      name: "Authors",
      roles: ["forms.editor"],
      environments: ["test"],
    });
    for (const result of [granted, changed]) {
      expect(result.ok && "held" in result).toBe(false);
    }
  });

  it("reads a held settings change as held, with the switch still on", async () => {
    status = 202;
    body = { workspaceId: "org_a", requireSecondApprover: true, request: { requestId: "apr_2" } };
    const { setWorkspaceSettings } = await import("./membership.ts");
    const held = await setWorkspaceSettings(SESSION, "org_a", { requireSecondApprover: false });
    expect(held).toEqual({
      ok: true,
      held: true,
      data: { workspaceId: "org_a", requireSecondApprover: true },
    });

    status = 200;
    body = { workspaceId: "org_a", requireSecondApprover: true };
    const done = await setWorkspaceSettings(SESSION, "org_a", { requireSecondApprover: true });
    expect(done).toEqual({
      ok: true,
      data: { workspaceId: "org_a", requireSecondApprover: true },
    });
  });

  it("re-confirms one hold and takes a person out of the workspace", async () => {
    body = { group: GROUP };
    const { reconfirmHolder, removeMember } = await import("./membership.ts");
    expect((await reconfirmHolder(SESSION, "org_a", "tm_1", "u_2")).ok).toBe(true);
    expect(adminApiFetch.mock.calls[0]?.[1]).toBe(
      "/workspaces/org_a/access-groups/tm_1/holders/u_2/reconfirm",
    );
    expect(adminApiFetch.mock.calls[0]?.[2]).toMatchObject({ method: "POST" });

    status = 204;
    expect(await removeMember(SESSION, "org_a", "u_2")).toEqual({ ok: true, data: null });
    expect(adminApiFetch.mock.calls[1]?.[1]).toBe("/workspaces/org_a/members/u_2");
    expect(adminApiFetch.mock.calls[1]?.[2]).toMatchObject({ method: "DELETE" });
  });

  it("reads each member's status, and an unknown one as active", async () => {
    body = {
      members: [
        {
          userId: "u_1",
          email: "a@x.test",
          name: "A",
          role: "member",
          status: "disabled",
          groups: [],
        },
        { userId: "u_2", email: "b@x.test", name: "B", role: "member", status: "odd", groups: [] },
      ],
    };
    const { listMembers } = await import("./membership.ts");
    const result = await listMembers(SESSION, "org_a");
    if (!result.ok) throw new Error("expected the list to succeed");
    expect(result.data.map((member) => member.status)).toEqual(["disabled", "active"]);
  });
});
