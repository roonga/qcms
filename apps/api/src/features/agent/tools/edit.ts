/**
 * The builder's edit tools (G3): each one changes the turn's working copy of the open draft and
 * records the result as one draft-scoped edit. Nothing is saved here: the browser applies each
 * edit through `PUT /admin/forms/{id}/draft` with the token the turn mints for it.
 */

import { z } from "zod";

import {
  FormDefinition as FormDefinitionSchema,
  GroupId,
  isRepeatGroup,
  LocalizedText,
  QuestionId,
  RuleId,
  Step,
  StepId,
  VisibilityRule,
  type FormDefinition,
} from "@roonga/qcms-core";

import { EDITS_PER_TURN, type EditOp } from "../edit-token.js";
import { canonicalJson } from "../proposal-token.js";

/** The ops a builder tool yields. Appearance is its own drawer and kinds, not a tool here. */
export const BUILDER_EDIT_OPS = [
  "question",
  "step",
  "rule",
  "copy",
] as const satisfies readonly EditOp[];

export type BuilderEditOp = (typeof BUILDER_EDIT_OPS)[number];

const Position = z
  .number()
  .int()
  .min(0)
  .max(500)
  .optional()
  .describe("Zero-based index to place it at. The end when absent.");

const Version = z.number().int().min(1).max(1_000_000);

export const EditQuestionInput = z.strictObject({
  action: z
    .enum(["pin", "repin", "move", "unpin"])
    .describe(
      "pin adds a published library question to a step; repin changes the version it pins; " +
        "move puts it on another step or position; unpin removes it from the form.",
    ),
  questionId: QuestionId,
  version: Version.optional().describe("The library version to pin. Required by pin and repin."),
  stepId: StepId.optional().describe("The step to place it on. Required by pin and move."),
  position: Position,
});

export const EditStepInput = z.strictObject({
  action: z
    .enum(["add", "replace", "move", "remove"])
    .describe(
      "add inserts a new step; replace swaps one step for the step given, title and items " +
        "included; move changes its position; remove deletes it.",
    ),
  stepId: StepId,
  step: Step.optional().describe(
    "The whole step, whose stepId must equal stepId. Required by add and replace.",
  ),
  position: Position,
});

export const EditRuleInput = z.strictObject({
  action: z
    .enum(["set", "remove"])
    .describe("set adds the rule or replaces the one with this ruleId; remove deletes it."),
  ruleId: RuleId,
  rule: VisibilityRule.optional().describe(
    "The whole rule, whose ruleId must equal ruleId. Required by set.",
  ),
});

export const EditCopyInput = z.strictObject({
  target: z
    .enum(["form-title", "step-title", "group-label", "group-instance-label"])
    .describe("Which wording to change."),
  stepId: StepId.optional().describe("The step whose title changes. Required by step-title."),
  groupId: GroupId.optional().describe(
    "The repeating group whose wording changes. Required by the two group targets.",
  ),
  text: LocalizedText.describe("The new wording, per locale."),
});

/** What the model learns of an edit: whether it applied, and the draft's advisory verdict after it. */
export const EditToolOutput = z.strictObject({
  accepted: z.boolean(),
  edit: z.number().int().optional(),
  reason: z.string().optional(),
  valid: z.boolean().optional(),
  issues: z.array(z.unknown()).optional(),
  warnings: z.array(z.unknown()).optional(),
});

/** One edit as the turn yields it: the op it is labelled with and the whole draft it leaves. */
export interface DraftEdit {
  readonly op: BuilderEditOp;
  readonly definition: FormDefinition;
}

class EditRefused extends Error {}

function refuse(reason: string): never {
  throw new EditRefused(reason);
}

function clone(definition: FormDefinition): FormDefinition {
  return structuredClone(definition);
}

function insertAt<T>(list: T[], item: T, position: number | undefined): void {
  const at = position === undefined ? list.length : Math.min(position, list.length);
  list.splice(at, 0, item);
}

function stepIndex(draft: FormDefinition, stepId: string): number {
  return draft.steps.findIndex((step) => step.stepId === stepId);
}

function requireStep(draft: FormDefinition, stepId: string | undefined, action: string) {
  if (stepId === undefined) refuse(`${action} needs a stepId.`);
  const index = stepIndex(draft, stepId);
  const step = draft.steps[index];
  if (step === undefined) refuse(`There is no step ${stepId} in this draft.`);
  return step;
}

/** Where a question sits: a top-level pin, or a member of a repeating group. */
function findPin(draft: FormDefinition, questionId: string) {
  for (const step of draft.steps) {
    for (const [index, item] of step.items.entries()) {
      if (!isRepeatGroup(item)) {
        if (item.questionId === questionId) return { step, index, group: undefined };
        continue;
      }
      const member = item.items.findIndex((ref) => ref.questionId === questionId);
      if (member >= 0) return { step, index: member, group: item };
    }
  }
  return undefined;
}

function applyQuestion(draft: FormDefinition, input: z.infer<typeof EditQuestionInput>): void {
  const found = findPin(draft, input.questionId);
  switch (input.action) {
    case "pin": {
      if (found !== undefined) refuse(`${input.questionId} is already on this form.`);
      if (input.version === undefined) refuse("pin needs the version to pin.");
      const step = requireStep(draft, input.stepId, "pin");
      insertAt(
        step.items,
        { questionId: input.questionId, version: input.version },
        input.position,
      );
      return;
    }
    case "repin": {
      if (found === undefined) refuse(`${input.questionId} is not on this form.`);
      if (input.version === undefined) refuse("repin needs the version to pin.");
      const list = found.group?.items ?? found.step.items;
      list[found.index] = { questionId: input.questionId, version: input.version };
      return;
    }
    case "move": {
      if (found === undefined) refuse(`${input.questionId} is not on this form.`);
      if (found.group !== undefined) {
        refuse("That question is inside a repeating group: replace the step with edit_step.");
      }
      const target = requireStep(draft, input.stepId, "move");
      const [pin] = found.step.items.splice(found.index, 1);
      if (pin === undefined) refuse(`${input.questionId} is not on this form.`);
      insertAt(target.items, pin, input.position);
      return;
    }
    case "unpin": {
      if (found === undefined) refuse(`${input.questionId} is not on this form.`);
      const list = found.group?.items ?? found.step.items;
      list.splice(found.index, 1);
      return;
    }
  }
}

function applyStep(draft: FormDefinition, input: z.infer<typeof EditStepInput>): void {
  const index = stepIndex(draft, input.stepId);
  if (input.step !== undefined && input.step.stepId !== input.stepId) {
    refuse("The step's own stepId must equal stepId.");
  }
  switch (input.action) {
    case "add":
      if (index >= 0) refuse(`There is already a step ${input.stepId}.`);
      if (input.step === undefined) refuse("add needs the whole step.");
      insertAt(draft.steps, input.step, input.position);
      return;
    case "replace":
      if (index < 0) refuse(`There is no step ${input.stepId} in this draft.`);
      if (input.step === undefined) refuse("replace needs the whole step.");
      draft.steps[index] = input.step;
      return;
    case "move": {
      if (index < 0) refuse(`There is no step ${input.stepId} in this draft.`);
      if (input.position === undefined) refuse("move needs the position to move it to.");
      const [step] = draft.steps.splice(index, 1);
      if (step === undefined) refuse(`There is no step ${input.stepId} in this draft.`);
      insertAt(draft.steps, step, input.position);
      return;
    }
    case "remove":
      if (index < 0) refuse(`There is no step ${input.stepId} in this draft.`);
      if (draft.steps.length === 1) refuse("A form keeps at least one step.");
      draft.steps.splice(index, 1);
      return;
  }
}

function applyRule(draft: FormDefinition, input: z.infer<typeof EditRuleInput>): void {
  const index = draft.rules.findIndex((rule) => rule.ruleId === input.ruleId);
  if (input.action === "remove") {
    if (index < 0) refuse(`There is no rule ${input.ruleId} in this draft.`);
    draft.rules.splice(index, 1);
    return;
  }
  if (input.rule === undefined) refuse("set needs the whole rule.");
  if (input.rule.ruleId !== input.ruleId) refuse("The rule's own ruleId must equal ruleId.");
  if (index < 0) draft.rules.push(input.rule);
  else draft.rules[index] = input.rule;
}

function requireGroup(draft: FormDefinition, groupId: string | undefined) {
  if (groupId === undefined) refuse("A group target needs a groupId.");
  for (const step of draft.steps) {
    for (const item of step.items) {
      if (isRepeatGroup(item) && item.groupId === groupId) return item;
    }
  }
  return refuse(`There is no repeating group ${groupId} in this draft.`);
}

function applyCopy(draft: FormDefinition, input: z.infer<typeof EditCopyInput>): void {
  switch (input.target) {
    case "form-title":
      draft.title = input.text;
      return;
    case "step-title":
      requireStep(draft, input.stepId, "step-title").title = input.text;
      return;
    case "group-label":
      requireGroup(draft, input.groupId).label = input.text;
      return;
    case "group-instance-label":
      requireGroup(draft, input.groupId).instanceLabel = input.text;
      return;
  }
}

const APPLY: Readonly<Record<BuilderEditOp, (draft: FormDefinition, input: unknown) => void>> = {
  question: (draft, input) => {
    applyQuestion(draft, EditQuestionInput.parse(input));
  },
  step: (draft, input) => {
    applyStep(draft, EditStepInput.parse(input));
  },
  rule: (draft, input) => {
    applyRule(draft, EditRuleInput.parse(input));
  },
  copy: (draft, input) => {
    applyCopy(draft, EditCopyInput.parse(input));
  },
};

export type EditOutcome =
  | { readonly ok: true; readonly definition: FormDefinition }
  | { readonly ok: false; readonly reason: string };

/**
 * One edit over the working draft. The result must still parse as a form definition, since the
 * save path refuses one that does not, and an edit that changes nothing is refused rather than
 * spending a save and an audit row on it.
 */
export function applyBuilderEdit(
  draft: FormDefinition,
  op: BuilderEditOp,
  input: unknown,
  editsSoFar: number,
): EditOutcome {
  if (editsSoFar >= EDITS_PER_TURN) {
    return {
      ok: false,
      reason: `A turn holds at most ${String(EDITS_PER_TURN)} edits. Stop here and say what is left.`,
    };
  }
  const next = clone(draft);
  try {
    APPLY[op](next, input);
  } catch (error) {
    if (error instanceof EditRefused) return { ok: false, reason: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, reason: error.issues[0]?.message ?? "Those arguments do not parse." };
    }
    throw error;
  }
  const parsed = FormDefinitionSchema.safeParse(next);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `The draft would no longer parse: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  }
  const before = FormDefinitionSchema.safeParse(draft);
  if (before.success && canonicalJson(before.data) === canonicalJson(parsed.data)) {
    return { ok: false, reason: "That edit changes nothing in the draft." };
  }
  return { ok: true, definition: parsed.data };
}
