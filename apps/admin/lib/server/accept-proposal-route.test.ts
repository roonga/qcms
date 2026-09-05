import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which endpoint an accepting save goes to (issue #823).
 *
 * `saveDraft` answers two different requests with one function, and the split is
 * the fix for a real defect rather than a convenience. An ordinary autosave is a
 * `PUT .../draft`. An accept that carries proposed NEW question definitions is a
 * `POST .../draft/assist/accept`, because those definitions have to be created
 * in the same transaction as the draft that pins them: the API used to have no
 * route that could do that, so accepting stored a draft pinning question ids
 * nothing had ever created and the builder rendered "Version not found".
 *
 * The subject here is the routing decision and the body shape, which is all this
 * layer owns (R2). Whether the definitions are acceptable is the kernel's
 * answer, pinned in `apps/api/src/features/forms/assist/assist.integration.test.ts`.
 */

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
    // Not disclaimed on every keystroke: absent, not `false`.
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
    // One request, carrying both halves: the draft and the questions it pins.
    // Two requests could not be atomic, which is the whole point of the route.
    expect(calls[0]?.body).toEqual({
      definition: DRAFT,
      newQuestions: [{ definition: proposed }],
    });
  });
});
