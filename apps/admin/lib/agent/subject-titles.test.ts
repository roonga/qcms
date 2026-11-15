import { describe, expect, it, vi, type Mock } from "vitest";

// Use the real action to reach its guards; stub only the reads it makes.

const reads = vi.hoisted(
  (): {
    forms: unknown;
    questions: unknown;
    listAllForms: Mock<() => Promise<unknown>>;
    listQuestions: Mock<() => Promise<unknown>>;
  } => ({
    forms: { ok: true, data: [] },
    questions: { ok: true, data: [] },
    listAllForms: vi.fn(() => Promise.resolve(reads.forms)),
    listQuestions: vi.fn(() => Promise.resolve(reads.questions)),
  }),
);

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve({ userId: "usr_1", token: "test-session-token" }),
}));
vi.mock("@/lib/server/workspace-context", () => ({
  currentWorkspaceId: () => Promise.resolve("org_default_workspace"),
}));
vi.mock("@/lib/server/forms", () => ({
  listAllForms: reads.listAllForms,
}));
vi.mock("@/lib/server/questions", () => ({
  listQuestions: reads.listQuestions,
}));

const { readSubjectTitlesAction } = await import("@/app/(shell)/assist/titles");

describe("the titles a card asks the screen for", () => {
  it("names a form and a question the operator can already see listed", async () => {
    reads.forms = {
      ok: true,
      data: [
        { formId: "frm_a", slug: "patient-sign-up", title: { en: "Larkmead new patient sign-up" } },
        { formId: "frm_other", slug: "other", title: { en: "Other" } },
      ],
    };
    reads.questions = {
      ok: true,
      data: [{ questionId: "q_full_name", slug: "full-name", label: { en: "Full name" } }],
    };

    await expect(readSubjectTitlesAction(["frm_a", "q_full_name"])).resolves.toEqual({
      frm_a: "Larkmead new patient sign-up",
      q_full_name: "Full name",
    });
  });

  it("falls back to the address when a row carries no title", async () => {
    reads.forms = { ok: true, data: [{ formId: "frm_a", slug: "patient-sign-up", title: null }] };
    reads.questions = {
      ok: true,
      data: [{ questionId: "q_full_name", slug: "full-name", label: null }],
    };

    await expect(readSubjectTitlesAction(["frm_a", "q_full_name"])).resolves.toEqual({
      frm_a: "patient-sign-up",
      q_full_name: "full-name",
    });
  });

  it("returns nothing when a read fails", async () => {
    reads.forms = { ok: false, code: "FORBIDDEN", message: "no" };
    reads.questions = { ok: false, code: "FORBIDDEN", message: "no" };

    await expect(readSubjectTitlesAction(["frm_a"])).resolves.toEqual({});
  });

  it("makes no read at all for an empty ask", async () => {
    reads.listAllForms.mockClear();
    reads.listQuestions.mockClear();

    await expect(readSubjectTitlesAction([])).resolves.toEqual({});
    expect(reads.listAllForms).not.toHaveBeenCalled();
    expect(reads.listQuestions).not.toHaveBeenCalled();
  });
});
