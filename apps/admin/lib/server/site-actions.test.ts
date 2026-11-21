import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../i18n/en.ts";

const calls = vi.hoisted(() => ({
  stepUp: [] as unknown[],
  promote: [] as string[],
  demote: [] as string[],
  decide: [] as string[],
  workspace: [] as string[],
  create: [] as { slug: string; firstAdministratorEmail?: string }[],
  stepUpOk: true,
  takenSlugs: new Set<string>(),
}));

const refused = (code: string) => ({ ok: false, code, message: code, issues: [] });

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () =>
    Promise.resolve({
      userId: "usr_me",
      email: "me@example.test",
      name: "Me",
      role: "admin",
      twoFactorEnabled: true,
      mustChangePassword: false,
      token: "session-token-for-this-test-only",
    }),
}));
vi.mock("@/lib/server/accounts", () => ({
  stepUp: (_session: unknown, credentials: unknown) => {
    calls.stepUp.push(credentials);
    return Promise.resolve(calls.stepUpOk ? { ok: true, data: null } : refused("STEP_UP_FAILED"));
  },
  promoteAccount: (_session: unknown, userId: string) => {
    calls.promote.push(userId);
    return Promise.resolve({ ok: true, data: { held: true } });
  },
  demoteAccount: (_session: unknown, userId: string) => {
    calls.demote.push(userId);
    return Promise.resolve({ ok: true, data: { held: false } });
  },
}));
vi.mock("@/lib/server/membership", () => ({
  approveWorkspaceRequest: (_s: unknown, _w: string, requestId: string) => {
    calls.workspace.push(`approve:${requestId}`);
    return Promise.resolve({ ok: true, data: {} });
  },
  rejectWorkspaceRequest: (_s: unknown, _w: string, requestId: string) => {
    calls.workspace.push(`reject:${requestId}`);
    return Promise.resolve(refused("OWN_REQUEST"));
  },
}));
vi.mock("@/lib/server/site-admin", () => ({
  decideSiteRequest: (_s: unknown, requestId: string, decision: string) => {
    calls.decide.push(`${decision}:${requestId}`);
    return Promise.resolve({ ok: true, data: {} });
  },
  createWorkspace: (_s: unknown, body: { slug: string; firstAdministratorEmail?: string }) => {
    calls.create.push(body);
    if (body.firstAdministratorEmail === "nobody@example.test") {
      return Promise.resolve(refused("FIRST_ADMINISTRATOR_NOT_FOUND"));
    }
    if (calls.takenSlugs.has(body.slug)) return Promise.resolve(refused("WORKSPACE_SLUG_TAKEN"));
    return Promise.resolve({ ok: true, data: { workspaceId: "org_new", name: "Clinical" } });
  },
  readStarterGroups: () =>
    Promise.resolve({
      ok: true,
      data: [{ name: "Authors", roles: ["forms.editor"], environments: ["test"] }],
    }),
}));

import {
  createWorkspaceAction,
  decideSiteRequestAction,
  decideWorkspaceRequestAction,
  demoteAction,
  promoteAction,
} from "../../app/(shell)/site/actions.ts";

const credentials = { password: "a-password-for-this-test", code: "123456" };

beforeEach(() => {
  calls.stepUp = [];
  calls.promote = [];
  calls.demote = [];
  calls.decide = [];
  calls.workspace = [];
  calls.create = [];
  calls.stepUpOk = true;
  calls.takenSlugs = new Set();
});

describe("promote and demote", () => {
  it("sends nothing when the step-up fails, so no request is made", async () => {
    calls.stepUpOk = false;
    const promoted = await promoteAction("usr_a", credentials);
    const demoted = await demoteAction("usr_b", credentials);
    expect(promoted).toMatchObject({ status: "error", code: "STEP_UP_FAILED" });
    expect(demoted).toMatchObject({ status: "error", code: "STEP_UP_FAILED" });
    expect(calls.promote).toEqual([]);
    expect(calls.demote).toEqual([]);
  });

  it("reports a held promotion and an applied demotion after a step-up", async () => {
    expect(await promoteAction("usr_a", credentials)).toEqual({
      status: "held",
      message: t("site.accounts.act.held"),
    });
    expect(await demoteAction("usr_b", credentials)).toEqual({
      status: "done",
      message: t("site.administrators.demote.done"),
    });
    expect(calls.stepUp).toHaveLength(2);
  });
});

describe("deciding a request", () => {
  it("approves a site request only after a step-up, and never without one", async () => {
    expect(await decideSiteRequestAction("apr_1", "approve")).toMatchObject({
      status: "error",
      code: "STEP_UP_REQUIRED",
    });
    calls.stepUpOk = false;
    expect(await decideSiteRequestAction("apr_1", "approve", credentials)).toMatchObject({
      status: "error",
    });
    expect(calls.decide).toEqual([]);
    calls.stepUpOk = true;
    expect(await decideSiteRequestAction("apr_1", "approve", credentials)).toMatchObject({
      status: "done",
    });
    expect(calls.decide).toEqual(["approve:apr_1"]);
  });

  it.each(["approve?x", "../x", ""])(
    "refuses the decision %j and makes no call",
    async (decision) => {
      const state = await decideSiteRequestAction("apr_1", decision as "approve", credentials);
      expect(state).toMatchObject({ status: "error", code: "http_400" });
      expect(calls.stepUp).toEqual([]);
      expect(calls.decide).toEqual([]);
    },
  );

  it("rejects a site request without a step-up", async () => {
    await decideSiteRequestAction("apr_2", "reject");
    expect(calls.stepUp).toEqual([]);
    expect(calls.decide).toEqual(["reject:apr_2"]);
  });

  it("decides a workspace request through its workspace, and words a refusal from the catalog", async () => {
    expect(await decideWorkspaceRequestAction("org_1", "apr_3", "approve")).toMatchObject({
      status: "done",
    });
    expect(await decideWorkspaceRequestAction("org_1", "apr_4", "reject")).toEqual({
      status: "error",
      code: "OWN_REQUEST",
      message: t("site.requests.blocked.own"),
    });
    expect(calls.workspace).toEqual(["approve:apr_3", "reject:apr_4"]);
  });
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("creating a workspace", () => {
  it("moves on to a numbered identifier when the name's own is taken", async () => {
    calls.takenSlugs = new Set(["clinical"]);
    const state = await createWorkspaceAction(
      { status: "idle" },
      form({ name: "Clinical", firstAdministrator: "" }),
    );
    expect(calls.create.map((body) => body.slug)).toEqual(["clinical", "clinical-2"]);
    expect(calls.create[0]?.firstAdministratorEmail).toBeUndefined();
    expect(state).toMatchObject({ status: "created", workspaceId: "org_new" });
  });

  it("names the refusal for an address no account has, keeping what was typed", async () => {
    const state = await createWorkspaceAction(
      { status: "idle" },
      form({ name: "Clinical", firstAdministrator: "nobody@example.test" }),
    );
    expect(state).toEqual({
      status: "error",
      code: "FIRST_ADMINISTRATOR_NOT_FOUND",
      message: "No account has that address.",
      submitted: { name: "Clinical", firstAdministrator: "nobody@example.test" },
    });
  });

  it("asks for a name before sending anything", async () => {
    const state = await createWorkspaceAction({ status: "idle" }, form({ name: "  " }));
    expect(state).toMatchObject({ status: "error", code: "http_400" });
    expect(calls.create).toEqual([]);
  });
});
