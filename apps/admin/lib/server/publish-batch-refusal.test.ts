import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../i18n/en.ts";

const adminApiFetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: { code } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  ),
);

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION: Parameters<typeof import("./releases.ts").publishBatch>[0] = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

let code = "APPROVER_IS_AUTHOR";

async function refusal(): Promise<string> {
  vi.resetModules();
  const { publishBatch } = await import("./releases.ts");
  const result = await publishBatch(SESSION, "frm_trip", {
    idempotencyKey: "key-1",
    expectedWorkflowRevision: null,
    draftRevision: 3,
    targets: [{ environment: "prod", expectedSequence: null }],
  });
  if (result.ok) throw new Error("expected the publish to be refused");
  return result.message;
}

beforeEach(() => {
  adminApiFetch.mockClear();
});

describe("a draft publish refused by second approval", () => {
  it("does not claim the caller froze a version that was never frozen", async () => {
    code = "APPROVER_IS_AUTHOR";
    expect(await refusal()).toBe(t("forms.publish.blocked.draftSecondApproval"));
  });

  it("leaves every other refusal with its catalog copy", async () => {
    code = "APPROVER_UNKNOWN_AUTHOR";
    expect(await refusal()).toBe(t("forms.error.approverUnknownAuthor"));
  });
});
