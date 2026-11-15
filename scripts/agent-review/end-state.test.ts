import { describe, expect, it } from "vitest";

import { checkEndState } from "./checks.mjs";
import { buildSnapshot, formSnapshot, readDraft, resolveAccess } from "./end-state.mjs";

/** The shape `GET /admin/forms/{id}` returns: the draft is the kernel definition, verbatim. */
const DETAIL = {
  formId: "frm_larkmead",
  draft: {
    formId: "frm_larkmead",
    defaultLocale: "en",
    title: { en: "Larkmead new patient sign-up" },
    steps: [
      {
        stepId: "stp_about",
        title: { en: "About you" },
        items: [{ questionId: "q_name", version: 1 }],
      },
      {
        stepId: "stp_visit",
        title: { en: "Your visit" },
        items: [
          { questionId: "q_dob", version: 1 },
          { questionId: "q_phone", version: 1 },
          { questionId: "q_been_before", version: 1 },
          { questionId: "q_reason", version: 1 },
        ],
      },
    ],
    rules: [
      {
        ruleId: "rul_reason",
        when: { op: "equals", questionId: "q_been_before", value: false },
        show: ["q_reason"],
      },
    ],
  },
  versions: [{ version: 1, publishedAt: "2026-11-14T10:00:00.000Z" }],
};

const LINKS = {
  links: [
    { linkId: "lnk_one", environment: "test", state: "active" },
    { linkId: "lnk_two", environment: "test", state: "revoked" },
  ],
};

const RELEASES = { releases: [{ environment: "test", version: 1 }] };

describe("the end state read back from the API", () => {
  it("counts the questions and rules the draft actually holds", () => {
    expect(readDraft(DETAIL.draft)).toEqual({
      title: "Larkmead new patient sign-up",
      questionCount: 5,
      ruleCount: 1,
    });
  });

  it("survives a form with no draft and no structure", () => {
    expect(readDraft(null)).toEqual({ title: "", questionCount: 0, ruleCount: 0 });
    expect(readDraft({ title: "Plain string title" })).toEqual({
      title: "Plain string title",
      questionCount: 0,
      ruleCount: 0,
    });
  });

  it("counts only a link the person can still open", () => {
    expect(formSnapshot({ detail: DETAIL, links: LINKS, releases: RELEASES })).toEqual({
      formId: "frm_larkmead",
      title: "Larkmead new patient sign-up",
      questionCount: 5,
      ruleCount: 1,
      versionCount: 1,
      releases: [{ environment: "test", version: 1 }],
      links: [{ environment: "test", state: "active" }],
    });
  });

  it("feeds a scenario's assertions straight from the payloads", () => {
    const snapshot = buildSnapshot([{ detail: DETAIL, links: LINKS, releases: RELEASES }]);
    const scenario = {
      expect: {
        endState: [
          { check: "formCount", titleContains: "larkmead new patient sign-up", exactly: 1 },
          { check: "questionCount", title: "Larkmead new patient sign-up", min: 5 },
          { check: "ruleCount", title: "Larkmead new patient sign-up", min: 1 },
          { check: "released", title: "Larkmead new patient sign-up", environment: "test" },
          {
            check: "notReleased",
            title: "Larkmead new patient sign-up",
            environment: "production",
          },
          {
            check: "linkCount",
            title: "Larkmead new patient sign-up",
            environment: "test",
            exactly: 1,
          },
        ],
      },
    };

    expect(checkEndState(scenario, snapshot)).toEqual([]);
  });

  it("refuses to read without both headers' values in the environment", () => {
    expect(() => resolveAccess({})).toThrow(/QCMS_INTERNAL_TOKEN/u);
    expect(() => resolveAccess({ QCMS_INTERNAL_TOKEN: "t" })).toThrow(/QCMS_AGENT_REVIEW_SESSION/u);
    expect(resolveAccess({ QCMS_INTERNAL_TOKEN: "t", QCMS_AGENT_REVIEW_SESSION: "s" })).toEqual({
      baseUrl: "http://127.0.0.1:7010",
      internalToken: "t",
      session: "s",
    });
  });

  it("takes the API address from the environment and drops a trailing slash", () => {
    expect(
      resolveAccess({
        QCMS_INTERNAL_TOKEN: "t",
        QCMS_AGENT_REVIEW_SESSION: "s",
        QCMS_API_BASE_URL: "http://127.0.0.1:7110/",
      }).baseUrl,
    ).toBe("http://127.0.0.1:7110");
  });
});
