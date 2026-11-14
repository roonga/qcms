import { effectiveReleaseWorkflow, listFormReleases } from "@roonga/qcms-db";
import type { Executor, FormReleaseHistoryRow } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import { ApiError } from "../../errors.js";
import { PRODUCTION_ENVIRONMENT } from "../membership/policy.js";

/** Every served environment other than `prod`, in the order given. */
export function nonProductionEnvironments(environments: readonly string[]): string[] {
  return environments.filter((environment) => environment !== PRODUCTION_ENVIRONMENT);
}

/**
 * Whether the fixed `prod` floor applies: `prod` is served beside at least one non-prod
 * environment. Independent of a caller's visible environments.
 */
export function productionFloorApplies(environments: readonly string[]): boolean {
  return (
    environments.includes(PRODUCTION_ENVIRONMENT) &&
    nonProductionEnvironments(environments).length > 0
  );
}

/**
 * The versions the deprecated `GET /forms/{id}.workflow` projection offers for `prod`:
 * every version with a release row anywhere, since any non-prod release satisfies the
 * floor and a prior `prod` release is a rollback. Removed with that projection.
 */
export function productionVersions(
  releases: readonly { environment: string; version: number }[],
): readonly number[] {
  return [...new Set(releases.map((release) => release.version))];
}

export interface WorkflowRule {
  readonly environment: string;
  /** A committed release of the same version in any one of these satisfies the rule. */
  readonly requiresPriorReleaseIn: readonly string[];
  readonly allowsDraftPublish: boolean;
  readonly allowsInBatch: boolean;
}

export interface EffectiveWorkflow {
  readonly revision: number | null;
  readonly source: "default" | "configured";
  readonly rules: readonly WorkflowRule[];
}

/** An environment the configured revision wrote no row for constrains nothing but the floor. */
const UNCONSTRAINED = {
  requiresPriorReleaseIn: [] as readonly string[],
  allowsDraftPublish: true,
  allowsInBatch: true,
} as const;

/**
 * The fixed `prod` floor, applied over whatever rule is configured: where a non-prod
 * environment is served, `prod` takes only a version already live in one and never a
 * draft. A configured prerequisite stays, since every name it may hold is non-prod and so
 * at least as strict. No revision can lift this.
 */
export function withProductionFloor(rule: WorkflowRule, served: readonly string[]): WorkflowRule {
  if (rule.environment !== PRODUCTION_ENVIRONMENT || !productionFloorApplies(served)) return rule;
  return {
    ...rule,
    requiresPriorReleaseIn:
      rule.requiresPriorReleaseIn.length > 0
        ? rule.requiresPriorReleaseIn
        : nonProductionEnvironments(served),
    allowsDraftPublish: false,
  };
}

/**
 * The deployment's behaviour with no revision written, stated as data: the `prod` floor
 * and nothing else. A prior release in the destination itself is the rollback exception
 * rather than a rule.
 */
export function defaultWorkflowRules(served: readonly string[]): WorkflowRule[] {
  return served.map((environment) =>
    withProductionFloor({ environment, ...UNCONSTRAINED }, served),
  );
}

/**
 * The revision in force, read once per review and once per commit. No row means the
 * derived default rather than an empty rule set, which would permit everything.
 */
export async function readWorkflow(
  exec: Executor,
  served: readonly string[],
): Promise<EffectiveWorkflow> {
  return effectiveWorkflow(await effectiveReleaseWorkflow(exec), served);
}

/** The rules a stored revision, or none, enforces over the served set, floor included. */
export function effectiveWorkflow(
  configured: { readonly revision: number; readonly rules: readonly WorkflowRule[] } | undefined,
  served: readonly string[],
): EffectiveWorkflow {
  if (configured === undefined) {
    return { revision: null, source: "default", rules: defaultWorkflowRules(served) };
  }
  const byName = new Map(configured.rules.map((rule) => [rule.environment, rule]));
  return {
    revision: configured.revision,
    source: "configured",
    rules: served.map((environment) =>
      withProductionFloor({ environment, ...(byName.get(environment) ?? UNCONSTRAINED) }, served),
    ),
  };
}

/** The rule for one destination; an unserved name constrains nothing here. */
export function ruleFor(workflow: EffectiveWorkflow, environment: string): WorkflowRule {
  return (
    workflow.rules.find((rule) => rule.environment === environment) ?? {
      environment,
      ...UNCONSTRAINED,
    }
  );
}

/**
 * The prerequisite code the deployment reports. The default revision keeps the code the
 * release dialog already reads; a configured revision names the rule it came from (F5).
 */
export function prerequisiteCode(workflow: EffectiveWorkflow): string {
  return workflow.source === "default" ? "TEST_RELEASE_REQUIRED" : "PRIOR_RELEASE_REQUIRED";
}

/**
 * A version with any prior release row in the destination itself: eligible there whatever
 * the prerequisites say, because moving back to what that environment already served is a
 * rollback rather than a promotion.
 */
export function isRollback(
  releases: readonly { environment: string; version: number }[],
  environment: string,
  version: number,
): boolean {
  return releases.some(
    (release) => release.environment === environment && release.version === version,
  );
}

/**
 * The committed rows that satisfied the destination's rule: rows in a required
 * environment, plus the destination's own rows where those make this a rollback. A sibling
 * target in the same confirmation supplies nothing, because every row here is committed.
 */
export function evidenceFor(
  releases: readonly FormReleaseHistoryRow[],
  input: { readonly version: number; readonly environment: string; readonly rule: WorkflowRule },
): FormReleaseHistoryRow[] {
  const sources = new Set(input.rule.requiresPriorReleaseIn);
  if (isRollback(releases, input.environment, input.version)) sources.add(input.environment);
  return releases.filter(
    (release) => release.version === input.version && sources.has(release.environment),
  );
}

/** The default revision's refusal; the code predates the floor and keeps its name. */
export function testReleaseRequired(
  environment: string,
  requiresAnyOf: readonly string[],
): ApiError {
  return new ApiError(
    "TEST_RELEASE_REQUIRED",
    409,
    `${environment} accepts only a version already published to ${requiresAnyOf.join(" or ")}. ` +
      `Publish this version there and verify it, then publish it to ${environment}.`,
    { environment, requiresAnyOf: [...requiresAnyOf] },
  );
}

export function priorReleaseRequired(
  environment: string,
  requiresAnyOf: readonly string[],
): ApiError {
  return new ApiError(
    "PRIOR_RELEASE_REQUIRED",
    409,
    `The release workflow requires a prior release of this version in one of ` +
      `${requiresAnyOf.join(", ")} before ${environment}.`,
    { environment, requiresAnyOf: [...requiresAnyOf] },
  );
}

export function draftPublishNotAllowed(environment: string): ApiError {
  return new ApiError(
    "DRAFT_PUBLISH_NOT_ALLOWED",
    409,
    `${environment} does not accept a draft. Publish it to another environment first, ` +
      `then publish that version to ${environment}.`,
    { environment },
  );
}

export function batchNotAllowed(environment: string): ApiError {
  return new ApiError(
    "BATCH_NOT_ALLOWED",
    409,
    `The release workflow does not allow ${environment} to be one of several destinations ` +
      "in one confirmation. Confirm it on its own.",
    { environment },
  );
}

/**
 * Refuse a destination that cannot take a version frozen in the same act: one that forbids
 * a combined publish, or one with a prerequisite the new version cannot satisfy, having
 * reached no environment yet. Shared with `publish-and-release`, which must not be a way
 * round a configured rule.
 */
export function requireDraftEligible(workflow: EffectiveWorkflow, environment: string): void {
  const rule = ruleFor(workflow, environment);
  if (rule.allowsDraftPublish && rule.requiresPriorReleaseIn.length === 0) return;
  if (workflow.source === "default") {
    throw testReleaseRequired(environment, rule.requiresPriorReleaseIn);
  }
  if (!rule.allowsDraftPublish) throw draftPublishNotAllowed(environment);
  throw priorReleaseRequired(environment, rule.requiresPriorReleaseIn);
}

/**
 * Refuse a destination whose prerequisite the committed history does not satisfy. The
 * caller passes the history so a transaction reads it once for every target.
 */
export function requirePrerequisite(input: {
  readonly workflow: EffectiveWorkflow;
  readonly releases: readonly FormReleaseHistoryRow[];
  readonly environment: string;
  readonly version: number;
}): void {
  const rule = ruleFor(input.workflow, input.environment);
  if (rule.requiresPriorReleaseIn.length === 0) return;
  if (isRollback(input.releases, input.environment, input.version)) return;
  const evidence = evidenceFor(input.releases, {
    version: input.version,
    environment: input.environment,
    rule,
  });
  if (evidence.length > 0) return;
  throw input.workflow.source === "default"
    ? testReleaseRequired(input.environment, rule.requiresPriorReleaseIn)
    : priorReleaseRequired(input.environment, rule.requiresPriorReleaseIn);
}

/**
 * The single-release path's eligibility check, which reads the history itself. The batch
 * path shares {@link requirePrerequisite} instead, over one read for every target.
 */
export async function requireReleaseCandidate(
  exec: Executor,
  served: readonly string[],
  environment: string,
  formId: FormId,
  version: number,
): Promise<void> {
  const workflow = await readWorkflow(exec, served);
  requirePrerequisite({
    workflow,
    releases: await listFormReleases(exec, formId),
    environment,
    version,
  });
}
