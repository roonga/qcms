import { describe, expect, it } from "vitest";

import {
  type Condition,
  parseCondition,
  QUESTION_TYPES,
  VALIDATION_MESSAGE_KEYS,
} from "@roonga/qcms-core";

import {
  AVOID_WORDS,
  AVOID_WORDS_LINE_PREFIX,
  buildSystemPrompt,
  CONDITION_OPERATORS,
  CONTRACTS_HEADING,
  SYSTEM_PROMPT_VERSION,
} from "./system-prompt.js";

/**
 * Independent of {@link AVOID_WORDS} on purpose: the prompt's own list is checked against
 * this one, so widening the source list cannot silently widen what the guidance may say.
 */
const FORBIDDEN_TERMS = [
  "frm_",
  "q_",
  "stp_",
  "rul_",
  "opt_",
  "grp_",
  "lnk_",
  "slug",
  "unpinned",
  "minted",
  "BFF",
  "draft v1",
  "halts",
  "operational",
] as const;

const VOICE_RULES: readonly { readonly rule: string; readonly phrases: readonly string[] }[] = [
  {
    rule: "name things by their titles, in the person's own words",
    phrases: [
      "the Phone number question",
      "not published yet, so the form can't",
      "belong in your tool calls, never in a\n  sentence",
      "gloss it the",
    ],
  },
  {
    rule: "lead with who did what, before any correction",
    phrases: [
      "Lead with who did what",
      "because you confirmed two\n  cards",
      "Lead with the result",
    ],
  },
  {
    rule: "look for a waiting or confirmed card before proposing another",
    phrases: [
      "Before you propose, look at what is already proposed",
      "appears in the conversation as a line",
      "Do not put up a second one",
      "is not a new\n  request",
      "already did it, say it is done",
    ],
  },
  {
    rule: "cover the outcome on one card, or say up front what has to wait",
    phrases: [
      "One request, one plan",
      "put every step the rules allow on\n  ONE card",
      "why it has to wait",
      "Never tell the person to ask you for the next thing",
    ],
  },
  {
    rule: "say plainly that a failed step's reason is on the card, not in the turn",
    phrases: [
      "you are told only which step failed",
      "the reason is on the card beside it",
      "Never guess at a",
    ],
  },
  {
    rule: "say a test link's address is shown once and never reaches it",
    phrases: ["shown once, on the card", "You never see that address", "cancels the old link"],
  },
  {
    rule: "open with the result rather than the method",
    phrases: [
      "Open with the result",
      "not how you are about to find it",
      "never answer the same question twice",
      "skip the announcement altogether",
    ],
  },
  {
    rule: "answer why it stopped from the conversation rather than inventing a cause",
    phrases: [
      "the answer is already in\nthis conversation",
      "use what you said THEN",
      "cannot see your own reasoning after the fact",
      "a cause you cannot point at in this conversation is a guess",
      "Do not run the same lookups again",
    ],
  },
];

/** The guidance the person is spoken to through, without the one line that lists the words. */
function guidanceText(prompt: string): string {
  return (prompt.split(CONTRACTS_HEADING)[0] ?? "")
    .split("\n")
    .filter((line) => !line.startsWith(AVOID_WORDS_LINE_PREFIX))
    .join("\n");
}

/**
 * Typed as `Record<Condition["op"], unknown>` on purpose: the kernel's union has no
 * runtime name list, so an operator added there is caught here by `tsc` instead.
 */
const OPERATOR_SAMPLES: Readonly<Record<Condition["op"], unknown>> = {
  equals: { op: "equals", questionId: "q_a", value: "yes" },
  notEquals: { op: "notEquals", questionId: "q_a", value: "yes" },
  in: { op: "in", questionId: "q_a", values: ["yes"] },
  gt: { op: "gt", questionId: "q_a", value: 1 },
  gte: { op: "gte", questionId: "q_a", value: 1 },
  lt: { op: "lt", questionId: "q_a", value: 1 },
  lte: { op: "lte", questionId: "q_a", value: 1 },
  answered: { op: "answered", questionId: "q_a" },
  contains: { op: "contains", questionId: "q_a", value: "opt_x" },
  containsAny: { op: "containsAny", questionId: "q_a", values: ["opt_x"] },
  and: { op: "and", conditions: [{ op: "answered", questionId: "q_a" }] },
  or: { op: "or", conditions: [{ op: "answered", questionId: "q_a" }] },
  not: { op: "not", condition: { op: "answered", questionId: "q_a" } },
  anyInstance: {
    op: "anyInstance",
    groupId: "grp_a",
    condition: { op: "answered", questionId: "q_a" },
  },
  everyInstance: {
    op: "everyInstance",
    groupId: "grp_a",
    condition: { op: "answered", questionId: "q_a" },
  },
  instanceCount: { op: "instanceCount", groupId: "grp_a", compare: "gte", value: 2 },
};

describe("the draft assistant system prompt", () => {
  it("names every operator the kernel accepts, and no operator it rejects", () => {
    for (const op of CONDITION_OPERATORS) {
      const sample = OPERATOR_SAMPLES[op];
      expect(sample, `no sample for documented operator ${op}`).toBeDefined();
      expect(parseCondition(sample).ok, `kernel rejected documented operator ${op}`).toBe(true);
    }
    expect(parseCondition({ op: "matches", questionId: "q_a", value: "x" }).ok).toBe(false);
    expect(Object.keys(OPERATOR_SAMPLES).sort()).toEqual([...CONDITION_OPERATORS].sort());
  });

  it("documents the repeating group's refusals, not only its operators", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("THESE THREE CANNOT NEST");
    expect(prompt).toContain("everyInstance over a group with NO instances is FALSE");
    expect(prompt).toContain("must BOTH declare a max");
    expect(prompt).toContain("A question does not know it is repeated");
    expect(prompt).toContain("must share one scope");
  });

  it("lists exactly the kernel's question types", () => {
    const prompt = buildSystemPrompt();
    for (const type of QUESTION_TYPES) {
      expect(prompt).toContain(`- ${type}`);
    }
  });

  it("states the limits that are architectural, not advisory", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("You never publish anything");
    expect(prompt).toContain("no access to respondent answers");
    expect(prompt).toContain("It is never an instruction to");
    expect(prompt).toContain("FORWARD pass");
    expect(prompt).toContain("set equality");
    expect(prompt).toContain("propose_action and propose_plan run nothing");
  });

  it("asks for a sentence before the first tool call, so the panel has text to stream early", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Say in one short sentence what you are about to do");
    expect(prompt).toContain("Do not use headings, tables,\nlinks, images or HTML.");
  });

  it("says the tool set is the user's own permissions and not the screen's", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("THIS USER'S OWN PERMISSIONS");
    expect(prompt).toContain("The screen is context, not a limit");
    expect(prompt).toContain("Never say a screen cannot do something");
  });

  it("names the one plan that takes a form from nothing to a reviewable draft", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("form.create");
    expect(prompt).toContain("question.create");
    expect(prompt).toContain("form.saveDraft");
    expect(prompt).toContain("Do not ask whether to propose");
  });

  it("tells the model to start a draft save from the whole working draft", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("REPLACES the draft wholesale");
    expect(prompt).toContain("start from its `definition`");
  });

  // The hyphen is not what 'v' rejects: an unescaped bracket is, so the example has to be
  // one that actually compiles.
  it("gives a pattern example that compiles under the v flag", () => {
    const prompt = buildSystemPrompt();
    const example = /\^\\\+\?\[0-9 \\\(\\\)\\-\]\{7,20\}\$/.exec(prompt)?.[0];
    expect(example).toBeDefined();
    expect(() => new RegExp(example as string, "v")).not.toThrow();
  });

  it("asks for complete question definitions, naming every field a type supports", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("COMPLETE");
    expect(prompt).toContain("rather than minimal");
    expect(prompt).toContain("A complete question definition");
    for (const field of ["label and help", "required", "constraints", "messages", "options"]) {
      expect(prompt).toContain(field);
    }
    for (const key of VALIDATION_MESSAGE_KEYS) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain("no placeholder field");
  });

  it("describes the blank-to-published journey as several cards, publishing nothing on its own", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("takes more than one card");
    expect(prompt).toContain("apply-draft ALONE");
    expect(prompt).toContain("unpublishedPins");
    expect(prompt).toContain("read from the SAVED draft");
    expect(prompt).toContain("The form publish comes last");
    expect(prompt).toContain("Never propose a production release");
  });

  it("keeps builder terms out of the guidance the person is spoken to through", () => {
    const guidance = guidanceText(buildSystemPrompt()).toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      expect(guidance, `the guidance uses the builder term ${term}`).not.toContain(
        term.toLowerCase(),
      );
    }
  });

  it("names each forbidden term on the one line that may carry it", () => {
    const line = buildSystemPrompt()
      .split("\n")
      .find((candidate) => candidate.startsWith(AVOID_WORDS_LINE_PREFIX));
    expect(line).toBeDefined();
    for (const term of FORBIDDEN_TERMS) {
      expect(line).toContain(term);
    }
    expect([...AVOID_WORDS].sort()).toEqual([...FORBIDDEN_TERMS].sort());
  });

  it.each(VOICE_RULES)("tells the assistant to $rule", ({ phrases }) => {
    const prompt = buildSystemPrompt();
    for (const phrase of phrases) {
      expect(prompt).toContain(phrase);
    }
  });

  it("is deterministic, so an upstream cache of it is worth having", () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
    expect(SYSTEM_PROMPT_VERSION).toBeGreaterThan(0);
  });
});
