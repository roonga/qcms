import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * The builder screen's own acts: the abuse-control settings and the intake door. Each runs
 * in the switcher's environment, so a plan proposed under one environment and confirmed
 * under another is refused before anything runs.
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

const IntakeArgs = z.strictObject({
  formId: z.string().min(1).max(200),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

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

export const closeForm: ActionKindDef = {
  kind: "form.close",
  screen: "/forms/[formId]",
  route: { method: "POST", path: "/admin/forms/{id}/close" },
  cell: { resource: "form", action: "close" },
  environmentFrom: "switcher",
  args: IntakeArgs,
  recomputeArgs: (facts) => ({ formId: facts.params.id ?? "" }),
  references: [],
  resultAllowlist: ["status", "environment"],
  card: {
    titleKey: "agent.card.form.close.title",
    consequenceKeys: ["agent.card.form.close.consequence"],
    headingControl: "builder.intake",
  },
  description:
    "Close the form to new sessions in the current environment. Every session already " +
    "under way keeps its pinned version and finishes normally.",
};

export const reopenForm: ActionKindDef = {
  kind: "form.reopen",
  screen: "/forms/[formId]",
  route: { method: "POST", path: "/admin/forms/{id}/reopen" },
  cell: { resource: "form", action: "close" },
  environmentFrom: "switcher",
  args: IntakeArgs,
  recomputeArgs: (facts) => ({ formId: facts.params.id ?? "" }),
  references: [],
  resultAllowlist: ["status", "environment"],
  card: {
    titleKey: "agent.card.form.reopen.title",
    consequenceKeys: ["agent.card.form.reopen.consequence"],
    headingControl: "builder.intake",
  },
  description: "Reopen the form to new sessions in the current environment.",
};
