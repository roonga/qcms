import { describe, expect, it } from "vitest";

import {
  compileDraft,
  isTableColumnType,
  parseFormDefinition,
  parseQuestionDefinition,
  publishErrorLocation,
  TABLE_COLUMN_TYPES,
  type DraftInput,
  type PublishError,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
} from "./index.js";

interface Member {
  readonly id: string;
  readonly type: string;
}

function makeQuestion(id: string, type: string): QuestionDefinition {
  const raw: Record<string, unknown> = {
    type,
    questionId: id,
    label: { en: id },
    required: false,
  };
  // A choice type does not parse without options.
  if (type === "singleChoice" || type === "multiChoice") {
    raw.options = [{ optionId: "opt_a", label: { en: "A" } }];
  }
  const result = parseQuestionDefinition(raw);
  if (!result.ok) {
    throw new Error(`test question did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// `fixed` is its own bound, so no case here trips `REPEAT_MAX_MISSING` first.
function publishGroup(members: readonly Member[], presentation: string): readonly PublishError[] {
  const questions = members.map((member) => makeQuestion(member.id, member.type));
  const parsed = parseFormDefinition({
    formId: "frm_assets",
    defaultLocale: "en",
    title: { en: "Assets" },
    steps: [
      {
        stepId: "stp_assets",
        title: { en: "Assets" },
        items: [
          {
            groupId: "grp_assets",
            label: { en: "Assets" },
            instanceLabel: { en: "Asset {n}" },
            items: members.map((member) => ({ questionId: member.id, version: 1 })),
            count: { source: "fixed", count: 2 },
            presentation,
          },
        ],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) {
    throw new Error(`test form did not parse: ${JSON.stringify(parsed.error)}`);
  }
  const records = new Map<string, QuestionVersionRecord>();
  const published = new Map<QuestionId, Set<number>>();
  for (const definition of questions) {
    records.set(`${definition.questionId}@1`, {
      questionId: definition.questionId,
      version: 1,
      definition,
    });
    published.set(definition.questionId, new Set([1]));
  }
  const draft: DraftInput = {
    definition: parsed.value,
    resolveQuestion: (questionId, version) => records.get(`${questionId}@${String(version)}`),
    publishedQuestionVersions: published,
  };
  const result = compileDraft(draft);
  return result.ok ? [] : result.error;
}

const ALL_FIVE: readonly Member[] = [
  { id: "q_as_name", type: "shortText" },
  { id: "q_as_value", type: "number" },
  { id: "q_as_acquired", type: "date" },
  { id: "q_as_insured", type: "boolean" },
  { id: "q_as_class", type: "singleChoice" },
];

describe("TABLE_COLUMN_TYPES (Q12, the five allowed cell types)", () => {
  it("is exactly the five the ruling names, and admits no other type", () => {
    expect([...TABLE_COLUMN_TYPES]).toEqual([
      "shortText",
      "number",
      "date",
      "boolean",
      "singleChoice",
    ]);
    expect(isTableColumnType("longText")).toBe(false);
    expect(isTableColumnType("multiChoice")).toBe(false);
    // Takes a string: the admin reads a library row whose type may be unknown.
    expect(isTableColumnType("table")).toBe(false);
  });

  it("publishes a table whose columns are all five", () => {
    expect(publishGroup(ALL_FIVE, "table")).toEqual([]);
  });
});

describe("TABLE_COLUMN_TYPE_NOT_ALLOWED (acceptance case 42)", () => {
  it.each([["longText"], ["multiChoice"]])(
    "refuses a %s column and names the stacked presentation",
    (type) => {
      const errors = publishGroup([...ALL_FIVE, { id: "q_as_extra", type }], "table");
      expect(errors).toHaveLength(1);
      const [error] = errors;
      expect(error?.code).toBe("TABLE_COLUMN_TYPE_NOT_ALLOWED");
      if (error?.code !== "TABLE_COLUMN_TYPE_NOT_ALLOWED") return;
      expect(error.path).toEqual({
        group: "grp_assets",
        question: "q_as_extra",
        step: "stp_assets",
        type,
      });
      expect(error.message).toContain("stacked");
      expect(error.message).toContain(type);
      expect(publishErrorLocation(error)).toBe(
        'column "q_as_extra" of group "grp_assets" in step "stp_assets"',
      );
    },
  );

  it("reports one error per refused column, because a publish report is complete", () => {
    const errors = publishGroup(
      [
        { id: "q_as_name", type: "shortText" },
        { id: "q_as_notes", type: "longText" },
        { id: "q_as_extras", type: "multiChoice" },
      ],
      "table",
    );
    expect(errors.map((error) => error.code)).toEqual([
      "TABLE_COLUMN_TYPE_NOT_ALLOWED",
      "TABLE_COLUMN_TYPE_NOT_ALLOWED",
    ]);
    expect(
      errors.map((error) =>
        error.code === "TABLE_COLUMN_TYPE_NOT_ALLOWED" ? error.path.question : "",
      ),
    ).toEqual(["q_as_notes", "q_as_extras"]);
  });

  it.each([["stacked"], ["perInstanceStep"]])(
    "leaves the same member list alone under the %s presentation",
    (presentation) => {
      expect(
        publishGroup(
          [
            { id: "q_as_name", type: "shortText" },
            { id: "q_as_notes", type: "longText" },
            { id: "q_as_extras", type: "multiChoice" },
          ],
          presentation,
        ),
      ).toEqual([]);
    },
  );

  it("says nothing about a column the form does not pin, which is already reported", () => {
    const parsed = parseFormDefinition({
      formId: "frm_assets",
      defaultLocale: "en",
      title: { en: "Assets" },
      steps: [
        {
          stepId: "stp_assets",
          title: { en: "Assets" },
          items: [
            {
              groupId: "grp_assets",
              label: { en: "Assets" },
              instanceLabel: { en: "Asset {n}" },
              items: [{ questionId: "q_as_ghost", version: 1 }],
              count: { source: "fixed", count: 2 },
              presentation: "table",
            },
          ],
        },
      ],
      rules: [],
    });
    if (!parsed.ok) throw new Error("test form did not parse");
    const result = compileDraft({
      definition: parsed.value,
      resolveQuestion: () => undefined,
      publishedQuestionVersions: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((error) => error.code)).toEqual(["DANGLING_QUESTION_REF"]);
  });
});
