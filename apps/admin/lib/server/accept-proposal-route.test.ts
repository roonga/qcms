import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  readonly path: string;
  readonly method: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const calls: Call[] = [];

const adminApiFetch = vi.fn(
  (
    _session: unknown,
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ): Promise<Response> => {
    calls.push({ path, method: init?.method, body: init?.body });
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

async function save(agentAssisted?: boolean, newQuestions?: readonly unknown[]): Promise<void> {
  const { saveDraft } = await import("./forms.ts");
  await saveDraft(SESSION, "frm_quote", DRAFT, agentAssisted, newQuestions);
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

  it("still PUTs the draft route for an accept that proposed no new questions", async () => {
    await save(true, []);
    expect(calls[0]?.path).toBe("/forms/frm_quote/draft");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toEqual({ definition: DRAFT, agentAssisted: true });
  });

  it("POSTs the accept route, with the definitions, when the proposal carried new questions", async () => {
    const proposed = { questionId: "q_first_name", type: "shortText", label: { en: "First" } };
    await save(true, [proposed]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/forms/frm_quote/draft/assist/accept");
    expect(calls[0]?.method).toBe("POST");

    expect(calls[0]?.body).toEqual({
      definition: DRAFT,
      newQuestions: [{ definition: proposed }],
    });
  });
});
