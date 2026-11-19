import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  readonly path: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const calls: Call[] = [];
let reply: Response = new Response(null, { status: 500 });

const adminApiFetch = vi.fn(
  (
    _session: unknown,
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: Record<string, unknown> },
  ): Promise<Response> => {
    calls.push({ path, method: init?.method, headers: init?.headers, body: init?.body });
    return Promise.resolve(reply);
  },
);

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls.length = 0;
});

describe("a card-less builder edit", () => {
  it("PUTs the turn's own definition object under the edit header, and returns its Undo token", async () => {
    reply = json(200, {
      issues: [],
      warnings: [],
      updatedAt: "2026-11-17T00:00:00.000Z",
      agentEdit: { undoToken: "undo_1" },
    });
    const { applyAgentEdit } = await import("./forms.ts");
    const definition = { title: { en: "T" }, formId: "frm_a" };
    const result = await applyAgentEdit(SESSION, "frm_a", definition, "edit_1");
    expect(calls[0]?.path).toBe("/forms/frm_a/draft");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers).toEqual({ "x-qcms-agent-edit": "edit_1" });
    expect(calls[0]?.body).toEqual({ definition });
    expect(calls[0]?.body?.["definition"]).toBe(definition);
    expect(result).toEqual({
      ok: true,
      data: { updatedAt: "2026-11-17T00:00:00.000Z", undoToken: "undo_1" },
    });
  });

  it("hands back AGENT_EDIT_MISMATCH when the save is not the draft the edit produced", async () => {
    reply = json(422, {
      error: {
        code: "AGENT_EDIT_MISMATCH",
        message: "That save is not the draft the assistant's edit produced.",
      },
    });
    const { applyAgentEdit } = await import("./forms.ts");
    const result = await applyAgentEdit(SESSION, "frm_a", {}, "edit_1");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.code).toBe("AGENT_EDIT_MISMATCH");
  });
});
