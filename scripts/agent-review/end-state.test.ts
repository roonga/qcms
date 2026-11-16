import { afterEach, describe, expect, it, vi } from "vitest";

import { checkEndState } from "./checks.mjs";
import {
  buildSnapshot,
  definitionsByPin,
  draftPins,
  ENVIRONMENT_HEADER,
  ENVIRONMENTS,
  formSnapshot,
  questionSettings,
  readDraft,
  readSnapshot,
  resolveAccess,
} from "./end-state.mjs";

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

/** `GET /admin/questions?versions=all`, cut down to the fields the settings are read from. */
const LIBRARY = {
  questions: [
    {
      questionId: "q_name",
      versions: [
        {
          version: 1,
          definition: {
            type: "shortText",
            label: { en: "Full name" },
            required: true,
            constraints: { maxLength: 100 },
          },
        },
      ],
    },
    {
      questionId: "q_dob",
      versions: [
        {
          version: 1,
          definition: {
            type: "date",
            label: { en: "Date of birth" },
            required: true,
            constraints: { min: "1900-01-01", max: "2021-11-14" },
          },
        },
        // A later version the draft does not pin: the settings must come from the pin.
        {
          version: 2,
          definition: { type: "date", label: { en: "Date of birth" }, required: false },
        },
      ],
    },
    {
      questionId: "q_phone",
      versions: [
        {
          version: 1,
          definition: {
            type: "shortText",
            label: { en: "Phone number" },
            required: false,
            constraints: { pattern: "^\\+?[0-9 \\(\\)\\-]{7,20}$" },
          },
        },
      ],
    },
    {
      questionId: "q_been_before",
      versions: [
        {
          version: 1,
          definition: {
            type: "multiChoice",
            label: { en: "How did you get in touch with us?" },
            required: true,
            options: [
              { optionId: "opt_phone", label: { en: "By phone" } },
              { optionId: "opt_email", label: { en: "By email" } },
              { optionId: "opt_none", label: { en: "I did not contact you" } },
            ],
          },
        },
      ],
    },
    {
      questionId: "q_reason",
      versions: [
        {
          version: 1,
          definition: {
            type: "singleChoice",
            label: { en: "I agree to the privacy notice" },
            required: true,
            options: [{ optionId: "opt_agree", label: { en: "I agree" } }],
          },
        },
      ],
    },
  ],
};

const SNAPSHOT = buildSnapshot([{ detail: DETAIL, links: LINKS, releases: RELEASES }], {
  library: LIBRARY,
  readAt: "2026-11-16",
});

/** @returns the check names one run of the assertions fired, in order. */
function fired(findings: { check: string }[]): string[] {
  return findings.map((entry) => entry.check);
}

function assertion(entry: Record<string, unknown>): {
  expect: { endState: Record<string, unknown>[] };
} {
  return { expect: { endState: [{ title: "Larkmead new patient sign-up", ...entry }] } };
}

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
    expect(formSnapshot({ detail: DETAIL, links: LINKS, releases: RELEASES })).toMatchObject({
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

describe("the question settings a scenario may assert", () => {
  it("names every question a draft pins, through a repeating group", () => {
    expect(draftPins(DETAIL.draft).map((pin) => pin.questionId)).toEqual([
      "q_name",
      "q_dob",
      "q_phone",
      "q_been_before",
      "q_reason",
    ]);
    expect(
      draftPins({
        steps: [
          {
            items: [
              { groupId: "grp_children", items: [{ questionId: "q_child_dob", version: 3 }] },
              { questionId: "q_total", version: 1 },
            ],
          },
        ],
      }),
    ).toEqual([
      { questionId: "q_child_dob", version: 3 },
      { questionId: "q_total", version: 1 },
    ]);
  });

  it("reads a date's bounds, a pattern, an option count and required off one definition", () => {
    expect(
      questionSettings({
        type: "date",
        label: { en: "Date of birth" },
        required: true,
        constraints: { min: "1900-01-01", max: "2021-11-14" },
      }),
    ).toEqual({
      type: "date",
      label: "Date of birth",
      required: true,
      optionCount: null,
      dateMin: "1900-01-01",
      dateMax: "2021-11-14",
      pattern: null,
    });
  });

  it("says a setting is absent rather than guessing at one", () => {
    expect(questionSettings({ type: "date", label: { en: "When" } })).toMatchObject({
      required: false,
      dateMin: null,
      dateMax: null,
      optionCount: null,
      pattern: null,
    });
    expect(questionSettings(null)).toMatchObject({ type: null, label: "", required: false });
  });

  it("resolves each pin to the version it names, not to the newest", () => {
    const pinned = definitionsByPin(LIBRARY);

    expect(pinned.get("q_dob@1")).toMatchObject({ required: true });
    expect(pinned.get("q_dob@2")).toMatchObject({ required: false });
    expect(pinned.get("q_dob")).toMatchObject({ required: false });
    expect(SNAPSHOT.forms[0]?.["questions"]).toMatchObject([
      { questionId: "q_name", required: true },
      { questionId: "q_dob", dateMax: "2021-11-14", required: true },
      { questionId: "q_phone", pattern: "^\\+?[0-9 \\(\\)\\-]{7,20}$" },
      { questionId: "q_been_before", optionCount: 3 },
      { questionId: "q_reason", optionCount: 1 },
    ]);
  });
});

describe("the end-state checks over those settings", () => {
  it("accepts a date of birth bounded on both sides and not in the future", () => {
    expect(
      checkEndState(
        {
          expect: {
            endState: [
              {
                check: "dateMax",
                title: "Larkmead new patient sign-up",
                labelContains: "date of birth",
                notAfter: "today",
              },
              {
                check: "dateMin",
                title: "Larkmead new patient sign-up",
                labelContains: "date of birth",
                notBefore: "1800-01-01",
              },
              {
                check: "required",
                title: "Larkmead new patient sign-up",
                labelContains: "date of birth",
              },
              {
                check: "pattern",
                title: "Larkmead new patient sign-up",
                labelContains: "phone",
              },
              {
                check: "optionCount",
                title: "Larkmead new patient sign-up",
                labelContains: "privacy",
                exactly: 1,
              },
              {
                check: "optionCount",
                title: "Larkmead new patient sign-up",
                labelContains: "touch",
                min: 3,
              },
            ],
          },
        },
        SNAPSHOT,
      ),
    ).toEqual([]);
  });

  it("fails a date of birth left open to the year 2100, which is the defect it came from", () => {
    const open = {
      readAt: "2026-11-16",
      forms: [
        {
          ...SNAPSHOT.forms[0],
          questions: [
            { questionId: "q_dob", label: "Date of birth", dateMax: null, required: false },
          ],
        },
      ],
    };
    const findings = checkEndState(
      assertion({ check: "dateMax", labelContains: "date of birth", notAfter: "today" }),
      open,
    );

    expect(fired(findings)).toEqual(["end-state.dateMax"]);
    expect(findings[0]?.text).toBe("it is not set at all");
  });

  it("fails a latest birth date that is still in the future on the day it was read", () => {
    const future = {
      readAt: "2026-11-16",
      forms: [
        { ...SNAPSHOT.forms[0], questions: [{ label: "Date of birth", dateMax: "2100-12-31" }] },
      ],
    };

    expect(
      checkEndState(
        assertion({ check: "dateMax", labelContains: "date of birth", notAfter: "today" }),
        future,
      )[0]?.text,
    ).toBe("2100-12-31 is later than 2026-11-16");
  });

  it("fails a consent left answerable either way, and one with a second option", () => {
    const loose = {
      readAt: "2026-11-16",
      forms: [
        {
          ...SNAPSHOT.forms[0],
          questions: [
            {
              label: "Do you agree to the privacy notice?",
              type: "boolean",
              required: false,
              optionCount: null,
            },
          ],
        },
      ],
    };

    expect(
      fired(checkEndState(assertion({ check: "required", labelContains: "privacy" }), loose)),
    ).toEqual(["end-state.required"]);
    expect(
      checkEndState(
        assertion({ check: "optionCount", labelContains: "privacy", exactly: 1 }),
        loose,
      )[0]?.text,
    ).toBe("a boolean offers no options");
  });

  it("fails a standalone answer capped at one selection, which forbids two ordinary ones", () => {
    const capped = {
      readAt: "2026-11-16",
      forms: [
        { ...SNAPSHOT.forms[0], questions: [{ label: "How did you reach us?", optionCount: 2 }] },
      ],
    };

    expect(
      checkEndState(assertion({ check: "optionCount", labelContains: "how", min: 5 }), capped)[0]
        ?.text,
    ).toBe("found 2 option(s), expected at least 5");
  });

  it("says so when no question's label matches, rather than passing on nothing", () => {
    expect(
      fired(checkEndState(assertion({ check: "pattern", labelContains: "passport" }), SNAPSHOT)),
    ).toEqual(["end-state.missing-question"]);
  });

  it("refuses to resolve today against an end state that records no date", () => {
    const dateless = { forms: SNAPSHOT.forms };

    expect(
      fired(
        checkEndState(
          assertion({ check: "dateMax", labelContains: "date of birth", notAfter: "today" }),
          dateless,
        ),
      ),
    ).toEqual(["end-state.no-read-date"]);
  });

  it("asserts a setting is absent as readily as present", () => {
    expect(
      fired(
        checkEndState(
          assertion({ check: "pattern", labelContains: "phone", set: false }),
          SNAPSHOT,
        ),
      ),
    ).toEqual(["end-state.pattern"]);
    expect(
      fired(
        checkEndState(
          assertion({ check: "dateMin", labelContains: "full name", set: false }),
          SNAPSHOT,
        ),
      ),
    ).toEqual([]);
  });
});

describe("the environments a snapshot is read in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a link and a release in every one, so an absence is a read rather than a guess", async () => {
    /** The environment each path was asked for, in call order. */
    const asked: [string, string][] = [];
    vi.stubGlobal("fetch", (url: string, init: { headers: Record<string, string> }) => {
      const path = new URL(url).pathname;
      asked.push([path, init.headers[ENVIRONMENT_HEADER] as string]);
      const body =
        path === "/admin/forms"
          ? { forms: [{ formId: "frm_one" }] }
          : path.endsWith("/links")
            ? { links: [{ environment: "prod", state: "active" }] }
            : path.endsWith("/releases")
              ? { releases: [{ environment: "prod", version: 1 }] }
              : { draft: null, versions: [], questions: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    const snapshot = await readSnapshot(
      { baseUrl: "http://api.invalid", internalToken: "t", session: "s" },
      ENVIRONMENTS,
    );

    expect(asked.filter(([path]) => path.endsWith("/links")).map(([, env]) => env)).toEqual([
      "test",
      "prod",
    ]);
    expect(asked.filter(([path]) => path === "/admin/forms")).toEqual([["/admin/forms", "test"]]);
    expect(snapshot.forms[0]?.["releases"]).toHaveLength(2);
  });
});
