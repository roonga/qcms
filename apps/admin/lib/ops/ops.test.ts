import { describe, expect, it } from "vitest";

import { answerText } from "./answers.ts";
import type { AppliedFilters } from "./browse.ts";
import { responsePageLink } from "./browse.ts";
import { isErasureConfirmed, isErasureReason } from "./erasure.ts";
import type { ExportChoice } from "./export.ts";
import { exportFilename, exportQuery, isExportable, versionRequired } from "./export.ts";
import { labelFor, labelsForPins, orderedAnswerKeys, pinsOf } from "./labels.ts";
import type { QuestionDetail } from "../questions/types.ts";

/**
 * Unit cover for the operations screens' pure rules (task 035).
 *
 * Each of these encodes a promise the UI makes in words, which is the class of defect
 * 034's retro names: copy written from intent rather than from state. A dialog that
 * says "type the session id to confirm" has to be backed by a predicate that accepts
 * exactly that and nothing else; a hint that says "CSV needs a version" has to be
 * backed by the rule that disables the button. So the words and the behaviour are
 * pinned to the same functions here, and the browser suite asserts the words.
 */

const choice = (overrides: Partial<ExportChoice> = {}): ExportChoice => ({
  format: "csv",
  version: "",
  from: "",
  to: "",
  ...overrides,
});

describe("erasure confirmation", () => {
  it("accepts the exact session id and nothing else - no single-click path", () => {
    expect(isErasureConfirmed("ses_abc123", "ses_abc123")).toBe(true);
    // Surrounding whitespace is a paste artefact, not a different intent.
    expect(isErasureConfirmed("  ses_abc123 ", "ses_abc123")).toBe(true);
  });

  it("refuses an empty box, a prefix, a different session, and the wrong case", () => {
    expect(isErasureConfirmed("", "ses_abc123")).toBe(false);
    expect(isErasureConfirmed("ses_abc", "ses_abc123")).toBe(false);
    expect(isErasureConfirmed("ses_other", "ses_abc123")).toBe(false);
    expect(isErasureConfirmed("SES_ABC123", "ses_abc123")).toBe(false);
  });

  it("refuses everything when there is no session id to match", () => {
    // A screen that lost its session id must not be confirmable by typing nothing.
    expect(isErasureConfirmed("", "")).toBe(false);
  });

  it("recognises only the recorded reasons", () => {
    expect(isErasureReason("subject_request")).toBe(true);
    expect(isErasureReason("because")).toBe(false);
  });
});

describe("export rules", () => {
  it("requires a version for CSV and not for JSON", () => {
    expect(versionRequired("csv")).toBe(true);
    expect(versionRequired("json")).toBe(false);
    expect(isExportable(choice())).toBe(false);
    expect(isExportable(choice({ version: "2" }))).toBe(true);
    expect(isExportable(choice({ format: "json" }))).toBe(true);
  });

  it("drops the version for JSON even when the control still holds one", () => {
    expect(exportQuery(choice({ format: "json", version: "2" }))).toBe("?format=json");
  });

  it("widens a chosen day to the whole UTC day, both ends", () => {
    const query = exportQuery(choice({ version: "2", from: "2026-07-01", to: "2026-07-31" }));
    expect(query).toContain("from=2026-07-01T00%3A00%3A00.000Z");
    expect(query).toContain("to=2026-07-31T23%3A59%3A59.999Z");
  });

  it("omits empty filters rather than sending blanks", () => {
    expect(exportQuery(choice({ version: "2" }))).toBe("?format=csv&version=2");
  });

  it("names the file after the form, the version and the format", () => {
    expect(exportFilename("frm_intake", choice({ version: "2" }))).toBe(
      "frm_intake-v2-responses.csv",
    );
    expect(exportFilename("frm_intake", choice({ format: "json" }))).toBe(
      "frm_intake-responses.json",
    );
  });
});

describe("answer rendering", () => {
  it("renders each canonical encoding", () => {
    expect(answerText("Ada")).toBe("Ada");
    expect(answerText(3)).toBe("3");
    expect(answerText(true)).toBe("true");
    expect(answerText(["opt_a", "opt_b"])).toBe("opt_a; opt_b");
  });

  it("distinguishes an empty answer from no answer", () => {
    // An empty string IS an answer; an absent one is not, and the caller words them
    // differently. Collapsing the two would caption a real answer as missing.
    expect(answerText("")).toBe("");
    expect(answerText(undefined)).toBeNull();
    expect(answerText(null)).toBeNull();
    expect(answerText([])).toBeNull();
  });
});

describe("question labels resolve through the pin", () => {
  const definition = {
    steps: [
      { stepId: "stp_one", items: [{ questionId: "q_name", version: 1 }] },
      {
        stepId: "stp_two",
        items: [
          { questionId: "q_age", version: 2 },
          { questionId: "q_gone", version: 9 },
        ],
      },
    ],
  };

  const details: QuestionDetail[] = [
    {
      questionId: "q_name",
      slug: "name",
      createdAt: "",
      versions: [
        {
          questionId: "q_name",
          version: 1,
          status: "published",
          publishedAt: null,
          definition: { questionId: "q_name", type: "shortText", label: { en: "Your name" } },
        },
        {
          questionId: "q_name",
          version: 2,
          status: "published",
          publishedAt: null,
          definition: { questionId: "q_name", type: "shortText", label: { en: "Full legal name" } },
        },
      ],
    },
    {
      questionId: "q_age",
      slug: "age",
      createdAt: "",
      versions: [
        {
          questionId: "q_age",
          version: 2,
          status: "published",
          publishedAt: null,
          definition: { questionId: "q_age", type: "number", label: { en: "Age" } },
        },
      ],
    },
  ];

  it("reads the pins out of a frozen definition", () => {
    expect(pinsOf(definition)).toEqual([
      { questionId: "q_name", version: 1 },
      { questionId: "q_age", version: 2 },
      { questionId: "q_gone", version: 9 },
    ]);
  });

  it("survives a definition it cannot read", () => {
    expect(pinsOf(undefined)).toEqual([]);
    expect(pinsOf({ steps: "nope" })).toEqual([]);
    expect(pinsOf({ steps: [{ items: [{ questionId: "q_x" }] }] })).toEqual([]);
  });

  it("captions with the PINNED version's wording, not the newest", () => {
    const labels = labelsForPins(pinsOf(definition), details);
    // q_name was pinned at v1, and v1 said "Your name". v2 renamed it, and the
    // response was never shown that wording.
    expect(labelFor(labels, "q_name")).toBe("Your name");
    expect(labelFor(labels, "q_age")).toBe("Age");
  });

  it("falls back to the id when the pinned version cannot be resolved", () => {
    const labels = labelsForPins(pinsOf(definition), details);
    // Better an id than a label the respondent never saw.
    expect(labelFor(labels, "q_gone")).toBe("q_gone");
    expect(labelFor(labels, "q_never_heard_of")).toBe("q_never_heard_of");
  });

  it("orders answers in document order, with strays appended", () => {
    const answers = { q_age: 30, q_stray: "x", q_name: "Ada" };
    expect(orderedAnswerKeys(answers, pinsOf(definition))).toEqual(["q_name", "q_age", "q_stray"]);
  });
});

describe("response page links", () => {
  const applied: AppliedFilters = { version: "2", from: "2026-01-01", to: "", flagged: "true" };

  it("carries the applied filter set and the target page", () => {
    expect(responsePageLink("frm_auto_quote", applied, 3)).toBe(
      "/forms/frm_auto_quote/responses?version=2&from=2026-01-01&flagged=true&page=3",
    );
  });

  it("omits absent filters rather than sending empty values", () => {
    // `to` is "" above. An empty `to=` is not the same request as no `to` at all, and
    // the API would have to guess which was meant.
    expect(responsePageLink("frm_auto_quote", applied, 3)).not.toContain("to=");
  });

  it("writes page 1 explicitly", () => {
    // A "Previous page" link that reloads must land on the page it named, not on an
    // implicit default that a later change to the default could move.
    expect(responsePageLink("frm_auto_quote", applied, 1)).toContain("page=1");
  });

  it("cannot carry a filter the operator has not applied", () => {
    // The regression this function exists for. A date typed into "From" and never
    // applied used to ride along with a "Next page" click, so the result set changed
    // for two reasons and the operator had asked for one. There is no draft state in
    // this module's scope, so a link built here can only ever describe the set the
    // server applied: the same filters in, the same query out.
    const draftTyped = { ...applied, from: "1999-12-31" };
    expect(responsePageLink("frm_auto_quote", applied, 2)).not.toContain("1999-12-31");
    expect(responsePageLink("frm_auto_quote", draftTyped, 2)).toContain("1999-12-31");
  });

  it("encodes a form id that would otherwise break the path", () => {
    expect(responsePageLink("frm a/b", applied, 1)).toContain("/forms/frm%20a%2Fb/responses?");
  });
});
