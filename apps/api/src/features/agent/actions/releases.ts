import { z } from "zod";

import { BatchTarget, PublishBatchBody, ReleaseBatchBody } from "../../releases/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { bodyMember, routeArgs, type StepArgs } from "./derive.js";
import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * The token binds an environment per step, because one plan can name two: "release v3 to
 * test, then promote it to prod" is verified on each step's own environment.
 */

const FormIdArg = z.string().min(1).max(200);

/**
 * One member of the destination a batch body names, which is the environment the step is
 * verified against. A body naming none or several is refused by the provenance check, so
 * this reads the one and reports nothing for any other shape.
 */
function soleTargetMember(name: string): (facts: ActionRequestFacts) => unknown {
  return (facts) => {
    const targets = bodyMember(facts, "targets");
    if (!Array.isArray(targets) || targets.length !== 1) return undefined;
    const target = targets[0] as Record<string, unknown> | undefined;
    return target?.[name];
  };
}

/** The version a `release-batch` body publishes, which lives under its source. */
function sourceVersion(facts: ActionRequestFacts): unknown {
  const source = bodyMember(facts, "source");
  return typeof source === "object" && source !== null
    ? (source as Record<string, unknown>)["version"]
    : undefined;
}

// A batch body nests what a step names: the version under `source`, the environment under
// the one destination `targets` carries. The expectations the wizard forwards are the
// browser's own, read off the review immediately before Confirm.
const BATCH_UNNAMED = ["idempotencyKey", "expectedWorkflowRevision", "source", "targets"] as const;

const publish = routeArgs(
  PublishBatchBody,
  {
    formId: FormIdArg,
    environment: BatchTarget.shape.environment.describe(
      "The one environment the newly frozen version goes live in.",
    ),
  } satisfies StepArgs<
    typeof PublishBatchBody.shape,
    (typeof BATCH_UNNAMED)[number],
    "formId" | "environment"
  >,
  {
    unnamed: BATCH_UNNAMED,
    params: { formId: "id" },
    readers: { environment: soleTargetMember("environment") },
  },
);

const release = routeArgs(
  ReleaseBatchBody,
  {
    formId: FormIdArg,
    version: ReleaseBatchBody.shape.source.shape.version.max(1_000_000),
    environment: BatchTarget.shape.environment,
    fromEnvironment: BatchTarget.shape.fromEnvironment,
  } satisfies StepArgs<
    typeof ReleaseBatchBody.shape,
    (typeof BATCH_UNNAMED)[number],
    "formId" | "version" | "environment" | "fromEnvironment"
  >,
  {
    unnamed: BATCH_UNNAMED,
    params: { formId: "id" },
    readers: {
      version: sourceVersion,
      environment: soleTargetMember("environment"),
      fromEnvironment: soleTargetMember("fromEnvironment"),
    },
  },
);

export const publishForm: ActionKindDef = {
  kind: "form.publish",
  screen: "/forms/[formId]",
  // The wizard's own route, so the card keeps its stale-review and workflow-revision
  // checks. The legacy single publish has neither, which would make the card weaker than
  // the dialog it mirrors.
  route: { method: "POST", path: "/admin/forms/{id}/publish-batch" },
  cell: { resource: "form", action: "publish" },
  alsoCells: [
    { resource: "form", action: "write" },
    { resource: "release", action: "create" },
  ],
  environmentFrom: "argument",
  environmentArgument: "environment",
  ...publish,
  references: ["version"],
  resultAllowlist: ["version", "environment"],
  card: {
    titleKey: "agent.card.form.publish.title",
    consequenceKeys: ["agent.card.form.publish.consequence", "agent.card.environment.production"],
    headingControl: "builder.publish",
  },
  description: ACTION_DESCRIPTIONS["form.publish"],
};

export const releaseVersion: ActionKindDef = {
  kind: "form.release",
  screen: "/forms/[formId]/publish",
  // The wizard's own route, so the card is refused on a stale confirmation exactly as the
  // wizard is: the batch body carries `expectedWorkflowRevision` and each destination's
  // `expectedSequence`, and the legacy single release carries neither.
  route: { method: "POST", path: "/admin/forms/{id}/release-batch" },
  cell: { resource: "release", action: "create" },
  environmentFrom: "argument",
  environmentArgument: "environment",
  ...release,
  // The version alone: that is what this step's audit row records, and a reference
  // resolves against the row rather than against anything the browser says.
  references: ["version"],
  resultAllowlist: ["version", "environment", "replacedVersion"],
  card: {
    titleKey: "agent.card.form.release.title",
    consequenceKeys: ["agent.card.form.release.consequence", "agent.card.environment.production"],
    headingControl: "releases.release",
  },
  description: ACTION_DESCRIPTIONS["form.release"],
};
