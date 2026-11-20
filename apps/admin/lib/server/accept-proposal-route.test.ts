import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  readonly path: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const calls: Call[] = [];

const adminApiFetch = vi.fn(
  (
    _session: unknown,
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: Record<string, unknown> },
  ): Promise<Response> => {
    calls.push({ path, method: init?.method, headers: init?.headers, body: init?.body });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          issues: [],
          warnings: [],
          agentAssisted: true,
          updatedAt: "2026-09-05T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
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

const DRAFT = {
  formId: "frm_quote",
  defaultLocale: "en",
  title: { en: "Quote" },
  steps: [{ stepId: "stp_start", title: { en: "Start" }, items: [] }],
  rules: [],
};

async function save(accept?: { token: string; newQuestions: readonly unknown[] }): Promise<void> {
  const { saveDraft } = await import("./forms.ts");
  await saveDraft(SESSION, "frm_quote", DRAFT, accept);
}

async function keep(token: string): Promise<void> {
  const { saveDraft } = await import("./forms.ts");
  await saveDraft(SESSION, "frm_quote", DRAFT, undefined, undefined, { token });
}

beforeEach(() => {
  calls.length = 0;
});

describe("saveDraft endpoint selection", () => {
  it("PUTs the draft route for an ordinary autosave", async () => {
    await save();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/forms/frm_quote/draft");
    expect(calls[0]?.method).toBe("PUT");

    expect(calls[0]?.body).toEqual({ definition: DRAFT });
  });

  it("POSTs the accept route under its token for an accept that proposed no new questions", async () => {
    await save({ token: "acc.tok", newQuestions: [] });
    expect(calls[0]?.path).toBe("/forms/frm_quote/draft/assist/accept");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers).toEqual({ "x-qcms-agent-accept": "acc.tok" });
    expect(calls[0]?.body).toEqual({ definition: DRAFT, newQuestions: [] });
  });

  it("sends no accept token and no agentAssisted mark on a plain save", async () => {
    await save();
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers?.["x-qcms-agent-accept"]).toBeUndefined();
    expect(calls[0]?.body).toEqual({ definition: DRAFT });
  });

  it("PUTs the draft route under the refused token when the user keeps the content", async () => {
    await keep("acc.tok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/forms/frm_quote/draft");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers).toEqual({ "x-qcms-agent-adopt": "acc.tok" });
    expect(calls[0]?.body).toEqual({ definition: DRAFT });
  });

  it("sends no adopt header on an ordinary autosave", async () => {
    await save();
    expect(calls[0]?.headers?.["x-qcms-agent-adopt"]).toBeUndefined();
  });

  it("POSTs the accept route, with the definitions, when the proposal carried new questions", async () => {
    const proposed = { questionId: "q_first_name", type: "shortText", label: { en: "First" } };
    await save({ token: "acc.tok", newQuestions: [proposed] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/forms/frm_quote/draft/assist/accept");
    expect(calls[0]?.method).toBe("POST");

    expect(calls[0]?.body).toEqual({
      definition: DRAFT,
      newQuestions: [{ definition: proposed }],
    });
  });
});
