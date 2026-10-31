import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * The token binds an environment per step, because one plan can name two: "release v3 to
 * test, then promote it to prod" is verified on each step's own environment.
 */

const ReleaseArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  version: z.number().int().min(1).max(1_000_000),
  environment: z.string().min(1).max(53),
  fromEnvironment: z.string().min(1).max(53).optional(),
});

const PublishArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  environment: z
    .string()
    .min(1)
    .max(53)
    .describe("The one environment the newly frozen version is released into."),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The destination the batch body names, which is the environment the step is verified
 * against. A body naming none or several is refused by the provenance check, so this
 * reads the one and reports nothing for any other shape.
 */
function soleTarget(facts: ActionRequestFacts): unknown {
  const targets = bodyMember(facts, "targets");
  if (!Array.isArray(targets) || targets.length !== 1) return undefined;
  const target = targets[0] as { environment?: unknown } | undefined;
  return target?.environment;
}

export const publishForm: ActionKindDef = {
  kind: "form.publish",
  screen: "/forms/[formId]",
  // The wizard's own route, so the card keeps its stale-review and workflow-revision
  // checks. The legacy single publish has neither, which would make the card weaker than
  // the dialog it mirrors.
  route: { method: "POST", path: "/admin/forms/{id}/publish-batch" },
  cell: { resource: "form", action: "publish" },
  alsoCell: { resource: "release", action: "create" },
  environmentFrom: "argument",
  environmentArgument: "environment",
  args: PublishArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    environment: soleTarget(facts),
  }),
  references: ["version"],
  resultAllowlist: ["version", "environment"],
  card: {
    titleKey: "agent.card.form.publish.title",
    consequenceKeys: ["agent.card.form.publish.consequence", "agent.card.environment.production"],
    headingControl: "builder.publish",
  },
  description:
    "Freeze the form's working draft as a new immutable version and release that version " +
    "into one environment, in one act. The release workflow, the two-person rule and the " +
    "production approval apply exactly as they do on the screen.",
};

export const releaseVersion: ActionKindDef = {
  kind: "form.release",
  screen: "/forms/[formId]/publish",
  route: { method: "POST", path: "/admin/forms/{id}/releases" },
  cell: { resource: "release", action: "create" },
  environmentFrom: "argument",
  environmentArgument: "environment",
  args: ReleaseArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    version: bodyMember(facts, "version"),
    environment: bodyMember(facts, "environment"),
    ...(bodyMember(facts, "fromEnvironment") === undefined
      ? {}
      : { fromEnvironment: bodyMember(facts, "fromEnvironment") }),
  }),
  // The version alone: that is what this step's audit row records, and a reference
  // resolves against the row rather than against anything the browser says.
  references: ["version"],
  resultAllowlist: ["version", "environment", "replacedVersion"],
  card: {
    titleKey: "agent.card.form.release.title",
    consequenceKeys: ["agent.card.form.release.consequence", "agent.card.environment.production"],
    headingControl: "releases.release",
  },
  description:
    "Release, promote or roll back a published version to one environment. The two-person " +
    "rule and the production approval apply exactly as they do on the screen.",
};
