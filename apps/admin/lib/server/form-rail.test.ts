import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResult } from "./api-result.ts";
import type { DraftForm, FormDetail, FormIssue } from "../forms/types.ts";

/**
 * The rail's two reads, and what each failure does instead of raising (issue 559).
 *
 * A rail is navigation beside a page, never the page, so `lib/server/form-rail.ts` states
 * that every failure degrades: a form that cannot be read gets no rail at all and leaves
 * the screen's own 404 or error alert to speak, and a validation that fails gets a rail
 * with no badges rather than one quietly claiming every step is clean. That is a promise
 * the browser cannot easily be made to break on demand - both failures need the API to be
 * down or the draft to be unparseable - so it is pinned here, where the two answers can
 * simply be handed back.
 *
 * The happy path is proved end to end in `apps/admin/e2e/rail.pw.ts` against a real
 * verdict, which is why the only thing asserted about it here is that the counts come from
 * the issues rather than from anywhere else.
 */

const getForm = vi.fn<(...args: never[]) => Promise<ApiResult<FormDetail>>>();
const validateDraft =
  vi.fn<
    (...args: never[]) => Promise<ApiResult<{ valid: boolean; issues: readonly FormIssue[] }>>
  >();

vi.mock("./forms.ts", () => ({ getForm, validateDraft }));

const DRAFT: DraftForm = {
  formId: "frm_life",
  defaultLocale: "en",
  title: { en: "Life cover" },
  steps: [
    {
      stepId: "stp_about",
      title: { en: "About you" },
      items: [{ questionId: "q_age", version: 1 }],
    },
    {
      stepId: "stp_health",
      title: { en: "Health" },
      items: [{ questionId: "q_smoker", version: 1 }],
    },
  ],
  rules: [],
};

const DETAIL: FormDetail = {
  formId: "frm_life",
  slug: "life",
  defaultLocale: "en",
  status: "open",
  draft: DRAFT,
  draftSource: "open",
  versions: [],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeProvider: "none",
};

/** A session object the mocked client never looks at. */
const SESSION = {} as never;

async function load() {
  const { loadFormRail } = await import("./form-rail.ts");
  return loadFormRail(SESSION, "frm_life");
}

beforeEach(() => {
  getForm.mockReset();
  validateDraft.mockReset();
});

describe("the rail's data", () => {
  it("attributes each issue to the step that carries it", async () => {
    getForm.mockResolvedValue({ ok: true, data: DETAIL });
    validateDraft.mockResolvedValue({
      ok: true,
      data: {
        valid: false,
        issues: [
          {
            code: "DEPRECATED_PIN",
            message: "x",
            path: { step: "stp_health", question: "q_smoker" },
          },
          { code: "LOCALE_INCOMPLETE", message: "y", path: { step: "stp_health" } },
        ],
      },
    });

    const rail = await load();
    expect(rail?.slug).toBe("life");
    expect(rail?.steps.map((step) => step.stepId)).toStrictEqual(["stp_about", "stp_health"]);
    expect([...(rail?.issueCounts ?? [])]).toStrictEqual([["stp_health", 2]]);
  });

  it("gives back no rail at all when the form itself cannot be read", async () => {
    getForm.mockResolvedValue({ ok: false, code: "FORM_NOT_FOUND", message: "gone", issues: [] });
    expect(await load()).toBeNull();
    expect(validateDraft).not.toHaveBeenCalled();
  });

  it("keeps the rail and drops the badges when the verdict cannot be had", async () => {
    getForm.mockResolvedValue({ ok: true, data: DETAIL });
    validateDraft.mockResolvedValue({ ok: false, code: "UPSTREAM", message: "down", issues: [] });

    const rail = await load();
    expect(rail?.steps).toHaveLength(2);
    expect(rail?.issueCounts.size, "empty, never a stand-in for zero").toBe(0);
  });

  it("asks for no verdict about a form that has no draft to validate", async () => {
    getForm.mockResolvedValue({ ok: true, data: { ...DETAIL, draft: null, draftSource: "none" } });

    const rail = await load();
    expect(rail?.steps).toStrictEqual([]);
    expect(validateDraft).not.toHaveBeenCalled();
  });
});
