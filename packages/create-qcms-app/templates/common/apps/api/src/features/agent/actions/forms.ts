import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * The builder screen's own acts: the draft the assistant proposes, the abuse-control
 * settings and the availability door. Each runs in the switcher's environment, so a plan proposed
 * under one environment and confirmed under another is refused before anything runs.
 */

// A plain object rather than a refined one: `argumentMembers` reads the shape to build the
// advertised schema, and the route already refuses a patch that names no setting.
const SettingsArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  challengeRequired: z
    .boolean()
    .optional()
    .describe("Whether a respondent must pass the challenge before submitting."),
  minSubmitMs: z
    .number()
    .int()
    .min(0)
    .max(600_000)
    .nullable()
    .optional()
    .describe("The minimum time on the form, or null to use the deployment's own floor."),
});

const AvailabilityArgs = z.strictObject({
  formId: z.string().min(1).max(200),
});

const SaveFormDraftArgs = z.strictObject({
  formId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The form whose draft this replaces. Name an earlier step's result where that step " +
        "creates the form.",
    ),
  definition: z
    .record(z.string(), z.unknown())
    .describe(
      "The complete draft: defaultLocale, title, steps and rules. Leave formId out of it; " +
        "the step's own formId argument is the form, and the server fills it in.",
    ),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The draft as the card showed it. `formId` is dropped because the form is the step's own
 * argument, and a plan that creates the form cannot name the minted id at proposal time, so
 * binding it would bind a value the model never chose.
 */
export function draftWithoutFormId(definition: unknown): unknown {
  if (typeof definition !== "object" || definition === null) return definition;
  const rest: Record<string, unknown> = { ...(definition as Record<string, unknown>) };
  delete rest["formId"];
  return rest;
}

/**
 * The draft the assistant proposed, applied through the builder's own save. It reaches no
 * route of its own: Confirm hands the draft to the builder, which stores it through the
 * one save path every other edit takes, carrying the agent-assisted mark.
 */
export const applyDraft: ActionKindDef = {
  kind: "apply-draft",
  screen: "/forms/[formId]",
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  args: AvailabilityArgs,
  recomputeArgs: (facts) => ({ formId: facts.params.id ?? "" }),
  references: [],
  // Counts, so the next turn learns what it applied without any of the draft travelling.
  resultAllowlist: ["changes", "newQuestions"],
  local: true,
  carriesProposedDraft: true,
  card: {
    titleKey: "agent.card.apply-draft.title",
    consequenceKeys: ["agent.card.apply-draft.consequence", "agent.card.apply-draft.provenance"],
  },
  description:
    "Apply the draft you proposed with propose_draft to this form's working draft, for the " +
    "user to review as a diff and confirm. Call propose_draft first. It publishes nothing " +
    "and releases nothing: the draft is stored as a draft and marked agent-assisted.",
};

/**
 * A complete draft saved through the route every other edit takes, with the agent-assisted
 * mark. Proposable from any screen, and its form may be one an earlier step of the same plan
 * created, which is what takes a form from blank to a reviewable draft under one Confirm.
 */
export const saveFormDraft: ActionKindDef = {
  kind: "form.saveDraft",
  screen: "/forms/[formId]",
  route: { method: "PUT", path: "/admin/forms/{id}/draft" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  args: SaveFormDraftArgs,
  normaliseArgs: (args) => ({ ...args, definition: draftWithoutFormId(args["definition"]) }),
  recomputeArgs: (facts) => ({
    formId: facts.params["id"] ?? "",
    definition: draftWithoutFormId(bodyMember(facts, "definition")),
  }),
  references: [],
  resultAllowlist: ["formId", "steps", "questions", "rules"],
  carriesDraftArgument: true,
  card: {
    titleKey: "agent.card.form.saveDraft.title",
    consequenceKeys: ["agent.card.form.saveDraft.consequence", "agent.card.apply-draft.provenance"],
  },
  description:
    "Save a complete draft to a form, through the same save path every edit in the builder " +
    "takes. It publishes nothing and releases nothing: the draft is stored as a draft and " +
    "marked agent-assisted. This is how a form goes from blank to a reviewable draft, after " +
    "form.create and any question.create steps of the same plan.",
};

export const updateFormSettings: ActionKindDef = {
  kind: "form.settings",
  screen: "/forms/[formId]",
  route: { method: "PATCH", path: "/admin/forms/{id}/settings" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  args: SettingsArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    ...(bodyMember(facts, "challengeRequired") === undefined
      ? {}
      : { challengeRequired: bodyMember(facts, "challengeRequired") }),
    ...(bodyMember(facts, "minSubmitMs") === undefined
      ? {}
      : { minSubmitMs: bodyMember(facts, "minSubmitMs") }),
  }),
  references: [],
  resultAllowlist: ["challengeRequired", "minSubmitMs", "challengeEnforceable"],
  card: {
    titleKey: "agent.card.form.settings.title",
    consequenceKeys: ["agent.card.form.settings.consequence"],
    headingControl: "builder.settings",
  },
  description:
    "Change the form's abuse-control settings. It affects sessions started from now on and " +
    "leaves every session already under way untouched.",
};

// Both kinds act on one environment's availability, and the builder edits a draft that
// belongs to no environment, so each names the per-form Availability screen.
export const closeForm: ActionKindDef = {
  kind: "form.close",
  screen: "/operations/forms/[formId]/availability",
  route: { method: "POST", path: "/admin/forms/{id}/close" },
  cell: { resource: "form", action: "close" },
  environmentFrom: "switcher",
  args: AvailabilityArgs,
  recomputeArgs: (facts) => ({ formId: facts.params.id ?? "" }),
  references: [],
  resultAllowlist: ["status", "environment"],
  card: {
    titleKey: "agent.card.form.close.title",
    consequenceKeys: ["agent.card.form.close.consequence"],
    headingControl: "intake.door",
  },
  description:
    "Close the form to new sessions in the current environment. Every session already " +
    "under way keeps its pinned version and finishes normally.",
};

export const reopenForm: ActionKindDef = {
  kind: "form.reopen",
  screen: "/operations/forms/[formId]/availability",
  route: { method: "POST", path: "/admin/forms/{id}/reopen" },
  cell: { resource: "form", action: "close" },
  environmentFrom: "switcher",
  args: AvailabilityArgs,
  recomputeArgs: (facts) => ({ formId: facts.params.id ?? "" }),
  references: [],
  resultAllowlist: ["status", "environment"],
  card: {
    titleKey: "agent.card.form.reopen.title",
    consequenceKeys: ["agent.card.form.reopen.consequence"],
    headingControl: "intake.door",
  },
  description: "Reopen the form to new sessions in the current environment.",
};
