import {
  compileDraft,
  parseFormDefinition,
  parseQuestionVersionRecord,
  type FrozenSnapshot,
  type QuestionId,
  type QuestionVersionRecord,
} from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { compileForm } from "./compile.js";
import { BOOLEAN_AFFIRMATION, BOOLEAN_FALSE_VALUE, BOOLEAN_TRUE_VALUE } from "./mapping.js";
import type { A2UINode } from "./types.js";

/**
 * Author-supplied validation messages (ADR-32) and boolean label overrides
 * (ADR-36) at the compiler seam, task 048.
 *
 * The golden corpus owns the byte-level contract (`golden-corpus.test.ts`: the
 * five pre-048 entries stay byte-identical, two appended entries exercise both
 * features). What this file owns is the *shape* of the forwarding: which prop
 * carries what, per-label and per-constraint fallback, key-order determinism,
 * and that the wire values never move.
 */

const en = (value: string): { en: string } => ({ en: value });

function versionRecord(definition: Record<string, unknown>): QuestionVersionRecord {
  const parsed = parseQuestionVersionRecord({
    questionId: definition.questionId,
    version: 1,
    definition,
  });
  if (!parsed.ok) {
    throw new Error(`question did not parse: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.value;
}

/** Publish a one-step form over the given question definitions. */
function snapshotOf(definitions: readonly Record<string, unknown>[]): FrozenSnapshot {
  const records = definitions.map(versionRecord);
  const form = parseFormDefinition({
    formId: "frm_messages",
    defaultLocale: "en",
    title: en("Messages"),
    steps: [
      {
        stepId: "stp_only",
        title: en("Only step"),
        items: records.map((record) => ({ questionId: record.questionId, version: 1 })),
      },
    ],
    rules: [],
  });
  if (!form.ok) {
    throw new Error(`form did not parse: ${JSON.stringify(form.error)}`);
  }
  const published = new Map<QuestionId, Set<number>>(
    records.map((record) => [record.questionId, new Set([1])]),
  );
  const result = compileDraft({
    definition: form.value,
    resolveQuestion: (questionId, version) =>
      records.find((record) => record.questionId === questionId && record.version === version),
    publishedQuestionVersions: published,
  });
  if (!result.ok) {
    throw new Error(`draft did not publish: ${JSON.stringify(result.error)}`);
  }
  return result.value.snapshot;
}

function childNodes(node: A2UINode): readonly A2UINode[] {
  const { children } = node;
  return children !== undefined && typeof children !== "string" ? children : [];
}

function walk(node: A2UINode, into: A2UINode[] = []): A2UINode[] {
  into.push(node);
  for (const child of childNodes(node)) walk(child, into);
  return into;
}

/** The compiled control node for one question, by its `name` prop. */
function controlFor(definitions: readonly Record<string, unknown>[], name: string): A2UINode {
  const compiled = compileForm(snapshotOf(definitions), {});
  const document = compiled.documents[0];
  if (document === undefined) throw new Error("no compiled document");
  const node = walk(document.root).find((candidate) => candidate.props?.name === name);
  if (node === undefined) throw new Error(`no control for ${name}`);
  return node;
}

const PLATE = {
  type: "shortText",
  questionId: "q_plate",
  label: en("Plate"),
  required: true,
  constraints: { minLength: 3, maxLength: 8 },
};

describe("author-supplied validation messages (ADR-32)", () => {
  it("forwards the resolved messages onto the control node as one optional prop", () => {
    const node = controlFor(
      [
        {
          ...PLATE,
          messages: { required: en("Plate is needed"), minLength: en("At least 3") },
        },
      ],
      "q_plate",
    );
    expect(node.props?.messages).toEqual({
      required: "Plate is needed",
      minLength: "At least 3",
    });
  });

  it("omits the prop entirely when the author supplied none (pre-048 content is unchanged)", () => {
    const node = controlFor([PLATE], "q_plate");
    expect(node.props).not.toHaveProperty("messages");
  });

  it("omits the prop for an empty message map rather than emitting `{}`", () => {
    const node = controlFor([{ ...PLATE, messages: {} }], "q_plate");
    expect(node.props).not.toHaveProperty("messages");
  });

  it("carries only the constraints the author decorated (per-constraint fallback)", () => {
    const node = controlFor([{ ...PLATE, messages: { maxLength: en("At most 8") } }], "q_plate");
    // `required` and `minLength` are absent, so the portal falls back to its
    // default catalog for those two and to the author's wording for maxLength.
    expect(Object.keys(node.props?.messages as Record<string, string>)).toEqual(["maxLength"]);
  });

  it("emits keys in the kernel's canonical order, not the authored object's order", () => {
    const node = controlFor(
      [
        {
          ...PLATE,
          messages: {
            maxLength: en("At most 8"),
            required: en("Plate is needed"),
            minLength: en("At least 3"),
          },
        },
      ],
      "q_plate",
    );
    expect(Object.keys(node.props?.messages as Record<string, string>)).toEqual([
      "required",
      "minLength",
      "maxLength",
    ]);
  });

  it("does not set errorMessage: the message is payload, the error slot stays the host's", () => {
    const node = controlFor([{ ...PLATE, messages: { required: en("Needed") } }], "q_plate");
    expect(node.props).not.toHaveProperty("errorMessage");
  });
});

describe("boolean label overrides (ADR-36)", () => {
  const bool = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: "boolean",
    questionId: "q_tows",
    label: en("Do you tow?"),
    ...extra,
  });

  function radioLabels(definition: Record<string, unknown>): readonly string[] {
    return childNodes(controlFor([definition], "q_tows")).map(
      (child) => child.props?.label as string,
    );
  }

  it("falls back to the lexicon when the author overrode neither", () => {
    expect(radioLabels(bool())).toEqual([BOOLEAN_AFFIRMATION.en.yes, BOOLEAN_AFFIRMATION.en.no]);
  });

  it("uses both overrides when the author wrote both", () => {
    expect(radioLabels(bool({ yesLabel: en("I tow"), noLabel: en("I never tow") }))).toEqual([
      "I tow",
      "I never tow",
    ]);
  });

  it("falls back per label: overriding one leaves the other on the lexicon", () => {
    expect(radioLabels(bool({ yesLabel: en("I tow") }))).toEqual([
      "I tow",
      BOOLEAN_AFFIRMATION.en.no,
    ]);
    expect(radioLabels(bool({ noLabel: en("I never tow") }))).toEqual([
      BOOLEAN_AFFIRMATION.en.yes,
      "I never tow",
    ]);
  });

  it("leaves the wire values untouched under override (presentation payload only)", () => {
    const node = controlFor(
      [bool({ yesLabel: en("I tow"), noLabel: en("I never tow") })],
      "q_tows",
    );
    expect(node.type).toBe("RadioGroup");
    expect(childNodes(node).map((child) => child.props?.value)).toEqual([
      BOOLEAN_TRUE_VALUE,
      BOOLEAN_FALSE_VALUE,
    ]);
  });
});
