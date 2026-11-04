import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftForm } from "../forms/types.ts";

const adminApiFetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ),
);

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION: Parameters<typeof import("./forms.ts").previewDraft>[0] = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

const DRAFT: DraftForm = {
  formId: "frm_trip",
  defaultLocale: "en",
  title: { en: "Trip" },
  steps: [],
  rules: [],
};

let body: Record<string, unknown> = {};

function previewBody(flow: Record<string, unknown>): Record<string, unknown> {
  return {
    documents: [],
    compilerVersion: "0.3.0",
    a2uiSpecVersion: "1.0.0",
    flow: {
      visibleSteps: ["stp_pax"],
      visibleQuestions: [],
      complete: false,
      rosters: [{ groupId: "grp_pax", instances: ["ins_p1", "ins_p2"] }],
      ...flow,
    },
  };
}

async function readFlow(): Promise<unknown> {
  const { previewDraft } = await import("./forms.ts");
  const result = await previewDraft(SESSION, "frm_trip", { definition: DRAFT, answers: {} });
  if (!result.ok) throw new Error("expected the preview read to succeed");
  return result.data.flow;
}

beforeEach(() => {
  adminApiFetch.mockClear();
});

describe("previewDraft reads the view list", () => {
  it("keeps visibleStepViews when the API sends it", async () => {
    const views = [
      { stepId: "stp_one", instanceId: null },
      { stepId: "stp_pax", instanceId: "ins_p1" },
      { stepId: "stp_pax", instanceId: "ins_p2" },
    ];
    body = previewBody({ visibleStepViews: views });
    expect(await readFlow()).toMatchObject({ visibleStepViews: views });
  });

  it("leaves it absent when the API omits it", async () => {
    body = previewBody({});
    expect(await readFlow()).not.toHaveProperty("visibleStepViews");
  });

  it("drops a malformed entry and keeps the well-formed ones", async () => {
    body = previewBody({
      visibleStepViews: [
        { stepId: "stp_pax", instanceId: "ins_p1" },
        { stepId: 7, instanceId: null },
        { stepId: "stp_pax", instanceId: 3 },
        { stepId: "stp_pax" },
        null,
        "stp_pax",
        { stepId: "stp_three", instanceId: null },
      ],
    });
    expect(await readFlow()).toMatchObject({
      visibleStepViews: [
        { stepId: "stp_pax", instanceId: "ins_p1" },
        { stepId: "stp_three", instanceId: null },
      ],
    });
  });
});
