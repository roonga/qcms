import { z } from "zod";

import { DraftBody, FormEnvironmentBody, UpdateFormSettingsBody } from "../../forms/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { bodyMember, routeArgs, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * The builder screen's own acts: the draft the assistant proposes, the abuse-control
 * settings and the availability door. Each runs in the switcher's environment, so a plan proposed
 * under one environment and confirmed under another is refused before anything runs.
 */

const FormIdArg = z.string().min(1).max(200);

const settings = routeArgs(
  UpdateFormSettingsBody,
  {
    formId: FormIdArg,
    challengeRequired: UpdateFormSettingsBody.shape.challengeRequired.describe(
      "Whether a respondent must pass the challenge before submitting.",
    ),
    minSubmitMs: UpdateFormSettingsBody.shape.minSubmitMs.describe(
      "The minimum time on the form, or null to use the deployment's own floor.",
    ),
  } satisfies StepArgs<typeof UpdateFormSettingsBody.shape, never, "formId">,
  // Both settings stay optional, because the route refuses a patch that names neither.
  { params: { formId: "id" } },
);

const availability = routeArgs(
  FormEnvironmentBody,
  { formId: FormIdArg } satisfies StepArgs<
    typeof FormEnvironmentBody.shape,
    "environment",
    "formId"
  >,
  // The environment is the switcher's, which a step binds rather than names.
  { unnamed: ["environment"], params: { formId: "id" } },
);

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

const saveDraft = routeArgs(
  DraftBody,
  {
    formId: FormIdArg.describe(
      "The form whose draft this replaces. Name an earlier step's result where that step " +
        "creates the form.",
    ),
    definition: DraftBody.shape.definition.describe(
      "The complete draft: defaultLocale, title, steps and rules. Leave formId out of it; " +
        "the step's own formId argument is the form, and the server fills it in.",
    ),
  } satisfies StepArgs<typeof DraftBody.shape, "appearance", "formId">,
  // An omitted `appearance` keeps the one the form already has, which is what a save the
  // assistant proposes always means.
  {
    unnamed: ["appearance"],
    params: { formId: "id" },
    readers: { definition: (facts) => draftWithoutFormId(bodyMember(facts, "definition")) },
  },
);

/**
 * The draft the assistant proposed, applied through the builder's own save. It reaches no
 * route of its own: Confirm hands the draft to the builder, which stores it through the
 * accept route, and that route writes the audit row.
 */
export const applyDraft: ActionKindDef = {
  kind: "apply-draft",
  screen: "/forms/[formId]",
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  args: z.strictObject({ formId: FormIdArg }),
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
  description: ACTION_DESCRIPTIONS["apply-draft"],
};

/**
 * A complete draft saved through the route every other edit takes; its token writes the
 * audit row. Proposable from any screen, and its form may be one an earlier step of the same plan
 * created, which is what takes a form from blank to a reviewable draft under one Confirm.
 */
export const saveFormDraft: ActionKindDef = {
  kind: "form.saveDraft",
  screen: "/forms/[formId]",
  route: { method: "PUT", path: "/admin/forms/{id}/draft" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  ...saveDraft,
  normaliseArgs: (args) => ({ ...args, definition: draftWithoutFormId(args["definition"]) }),
  references: [],
  resultAllowlist: ["formId", "steps", "questions", "rules"],
  carriesDraftArgument: true,
  card: {
    titleKey: "agent.card.form.saveDraft.title",
    consequenceKeys: ["agent.card.form.saveDraft.consequence", "agent.card.apply-draft.provenance"],
  },
  description: ACTION_DESCRIPTIONS["form.saveDraft"],
};

export const updateFormSettings: ActionKindDef = {
  kind: "form.settings",
  screen: "/forms/[formId]",
  route: { method: "PATCH", path: "/admin/forms/{id}/settings" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  ...settings,
  references: [],
  resultAllowlist: ["challengeRequired", "minSubmitMs", "challengeEnforceable"],
  card: {
    titleKey: "agent.card.form.settings.title",
    consequenceKeys: ["agent.card.form.settings.consequence"],
    headingControl: "builder.settings",
  },
  description: ACTION_DESCRIPTIONS["form.settings"],
};

// Both kinds act on one environment's availability, and the builder edits a draft that
// belongs to no environment, so each names the per-form Availability screen.
export const closeForm: ActionKindDef = {
  kind: "form.close",
  screen: "/operations/forms/[formId]/availability",
  route: { method: "POST", path: "/admin/forms/{id}/close" },
  cell: { resource: "form", action: "close" },
  environmentFrom: "switcher",
  ...availability,
  references: [],
  resultAllowlist: ["status", "environment"],
  card: {
    titleKey: "agent.card.form.close.title",
    consequenceKeys: ["agent.card.form.close.consequence"],
    headingControl: "intake.door",
  },
  description: ACTION_DESCRIPTIONS["form.close"],
};

export const reopenForm: ActionKindDef = {
  kind: "form.reopen",
  screen: "/operations/forms/[formId]/availability",
  route: { method: "POST", path: "/admin/forms/{id}/reopen" },
  cell: { resource: "form", action: "close" },
  environmentFrom: "switcher",
  ...availability,
  references: [],
  resultAllowlist: ["status", "environment"],
  card: {
    titleKey: "agent.card.form.reopen.title",
    consequenceKeys: ["agent.card.form.reopen.consequence"],
    headingControl: "intake.door",
  },
  description: ACTION_DESCRIPTIONS["form.reopen"],
};
