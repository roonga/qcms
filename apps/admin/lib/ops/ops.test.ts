import { describe, expect, it } from "vitest";

import {
  answerPreview,
  answerPreviewText,
  answerText,
  PREVIEW_ENTRIES,
  PREVIEW_VALUE_CHARS,
} from "./answers.ts";
import type { AppliedFilters } from "./browse.ts";
import { responsePageLink } from "./browse.ts";
import { isErasureConfirmed, isErasureReason } from "./erasure.ts";
import type { ExportChoice } from "./export.ts";
import {
  exportFilename,
  exportQuery,
  isExportable,
  parseExportFilters,
  versionRequired,
} from "./export.ts";
import { labelFor, labelsForPins, orderedAnswerKeys, pinsOf } from "./labels.ts";
import { t } from "../i18n/en.ts";
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

/**
 * Reading the export link back (issue 551).
 *
 * The link `exportQuery` writes and the filters `parseExportFilters` reads are the two
 * ends of one string, so the first case is the round trip: what the dialog builds is
 * what the route applies. The rest pin the borrowed validators - a value the response
 * browser drops is a value this refuses, rather than a second opinion about the same
 * three parameters. The route's own behaviour on a refusal (a 400, and no upstream
 * call) is asserted in `app/(shell)/forms/[formId]/export/route.test.ts`.
 */
describe("export filter parsing", () => {
  const parse = (search: string) => parseExportFilters(new URLSearchParams(search));

  it("round-trips the dialog's own link", () => {
    const link = exportQuery(choice({ version: "2", from: "2026-07-01", to: "2026-07-31" }));
    const parsed = parse(link);

    expect(parsed).toEqual({
      ok: true,
      filters: {
        version: "2",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-31T23:59:59.999Z",
      },
    });
  });

  it("accepts a bare day as the same day, so a hand-typed range means what it says", () => {
    expect(parse("from=2026-07-01&to=2026-07-31")).toEqual({
      ok: true,
      filters: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" },
    });
  });

  it("canonicalizes the version the way the response browser does", () => {
    expect(parse("version=0001")).toEqual({ ok: true, filters: { version: "1" } });
  });

  it("treats an absent or empty parameter as no filter and no complaint", () => {
    expect(parse("")).toEqual({ ok: true, filters: {} });
    expect(parse("version=&from=&to=")).toEqual({ ok: true, filters: {} });
  });

  it("refuses what the response browser would drop, naming every parameter", () => {
    expect(parse("from=nonsense")).toEqual({ ok: false, invalid: ["from"] });
    expect(parse("version=abc&to=03/01/2026")).toEqual({ ok: false, invalid: ["version", "to"] });
    expect(parse("version=0")).toEqual({ ok: false, invalid: ["version"] });
  });

  it("refuses a day-shaped day that does not exist, which Date would roll forward", () => {
    expect(parse("from=2026-02-31")).toEqual({ ok: false, invalid: ["from"] });
  });

  it("refuses a partial instant: the export's unit is a whole day at both ends", () => {
    expect(parse("from=2026-07-01T12:00:00.000Z")).toEqual({ ok: false, invalid: ["from"] });
    expect(parse("to=2026-07-31T00:00:00.000Z")).toEqual({ ok: false, invalid: ["to"] });
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

describe("answer preview for the browser table (issue 515)", () => {
  it("previews the first two answered questions, in a deterministic order", () => {
    // Keys deliberately out of order in the literal: the map arrives as parsed JSON and
    // nothing guarantees the order it was written in, so the column has to sort. Two
    // rows with the same answers must preview identically, and one row must preview the
    // same way on every render.
    const preview = answerPreview({ q_c: "third", q_a: "first", q_b: "second" });
    expect(preview.entries.map((entry) => entry.questionId)).toEqual(["q_a", "q_b"]);
    expect(preview.entries.map((entry) => entry.value)).toEqual(["first", "second"]);
    expect(preview.hidden).toBe(1);
  });

  it("bounds how much respondent-entered text a list row can show", () => {
    // The privacy budget, asserted as a number rather than trusted as a comment. A free
    // text answer must be cut mid-clause: the list is a scan aid, and reading a response
    // is the detail screen's audited job.
    const essay = "x".repeat(500);
    const preview = answerPreview({ q_story: essay, q_other: essay });
    expect(preview.entries).toHaveLength(PREVIEW_ENTRIES);
    for (const entry of preview.entries) {
      expect(entry.value).toHaveLength(PREVIEW_VALUE_CHARS);
      expect(entry.clipped).toBe(true);
    }
    // Whatever the answers hold, one row exposes at most this much of them.
    const shown = preview.entries.reduce((total, entry) => total + entry.value.length, 0);
    expect(shown).toBeLessThanOrEqual(PREVIEW_ENTRIES * PREVIEW_VALUE_CHARS);
  });

  it("does not mark a value that fitted as clipped", () => {
    const preview = answerPreview({ q_a: "x".repeat(PREVIEW_VALUE_CHARS) });
    expect(preview.entries[0]?.clipped).toBe(false);
    expect(preview.hidden).toBe(0);
  });

  it("renders every non-string encoding rather than leaking an object", () => {
    // `[object Object]` in an operator's table is a defect, and so is a blank cell where
    // a number or a boolean was answered. The preview reuses `answerText`, so the four
    // canonical encodings and the unexpected shape all come out readable.
    const preview = answerPreview({ q_1: 12, q_2: false });
    expect(preview.entries.map((entry) => entry.value)).toEqual(["12", "false"]);
    expect(answerPreview({ q_1: ["opt_a", "opt_b"] }).entries[0]?.value).toBe("opt_a; opt_b");
    const odd = answerPreview({ q_1: { nested: true } }).entries[0]?.value;
    expect(odd).toBe('{"nested":true}');
    expect(odd).not.toContain("[object");
  });

  it("skips a question that carries no value, and does not count it as more", () => {
    // A retracted or absent answer is not something to preview: spending a slot on a
    // blank costs the next real answer its place, and counting it would tell the
    // operator there is more to see when there is not.
    const preview = answerPreview({ q_a: null, q_b: [], q_c: "kept" });
    expect(preview.entries.map((entry) => entry.questionId)).toEqual(["q_c"]);
    expect(preview.hidden).toBe(0);
  });

  it("says nothing rather than something wrong when a response has no answers", () => {
    // Every question optional, or every one hidden by a condition: a submitted response
    // can legitimately hold nothing. The caller words this case; what matters here is
    // that it is distinguishable from "two answers" and cannot throw.
    expect(answerPreview({})).toEqual({ entries: [], hidden: 0 });
  });
});

/**
 * The preview's punctuation, read from the catalog rather than retyped.
 *
 * The assertions below are then about the SHAPE the cell composes - pairs, separators,
 * a clip marker, a more marker - and not about which characters `en.ts` currently
 * spells them with, so a wording change is not a test change.
 */
const SEPARATOR = t("ops.responses.preview.separator");
const MORE = t("ops.responses.preview.more");
const CLIP = t("ops.responses.preview.clipped", { value: "" });

describe("the answer-preview cell's text (issue 515)", () => {
  it("reads as captioned pairs, and marks that there are more", () => {
    const text = answerPreviewText({ q_a: "Yes", q_b: 12, q_c: "third" });
    expect(text).toBe(`q_a: Yes${SEPARATOR}q_b: 12${SEPARATOR}${MORE}`);
  });

  it("carries no separator and no more-marker when one answer is all there is", () => {
    // The `auto` fixture's own shape: answering "no" to the at-fault question hides the
    // count, so a real submitted row holds exactly one answer.
    expect(answerPreviewText({ q_at_fault_accident: false })).toBe("q_at_fault_accident: false");
  });

  it("never puts a whole free-text answer into the markup", () => {
    // The privacy claim the column rests on, asserted rather than asserted-in-prose.
    // The clip happens on the string that BECOMES the text node, so there is no second
    // copy anywhere for a tooltip or a data attribute to hold - which is exactly why
    // this cell has no `title`.
    const secret = "I was driving my mother's car without telling the insurer about it";
    const text = answerPreviewText({ q_story: secret });
    expect(text).not.toContain(secret);
    expect(text).toContain(secret.slice(0, PREVIEW_VALUE_CHARS));
    expect(text.endsWith(CLIP)).toBe(true);
  });

  it("names the empty state instead of rendering an empty cell", () => {
    // The state this layer exists to reach. A blank cell reads as a rendering failure
    // to a sighted operator and announces as nothing at all to a screen reader.
    const text = answerPreviewText({});
    expect(text).toBe(t("ops.responses.preview.none"));
    expect(text.trim()).not.toBe("");
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
