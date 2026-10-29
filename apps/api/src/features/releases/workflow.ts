import { effectiveReleaseWorkflow, listFormReleases } from "@roonga/qcms-db";
import type { Executor, FormReleaseHistoryRow } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import { ApiError } from "../../errors.js";
import { PRODUCTION_ENVIRONMENT } from "../membership/policy.js";

/** The deployment's test/prod workflow, independent of a caller's visible environments. */
export function usesTestWorkflow(environments: readonly string[]): boolean {
  return environments.includes("test") && environments.includes("prod");
}

/**
 * The versions the deprecated `GET /forms/{id}.workflow` projection offers for `prod`.
 * It reads the derived default alone and is removed with that projection.
 */
export function productionVersions(
  releases: readonly { environment: string; version: number }[],
): readonly number[] {
  return [
    ...new Set(
      releases
        .filter((release) => release.environment === "test" || release.environment === "prod")
        .map((release) => release.version),
    ),
  ];
}

/** What one destination permits. */
export interface WorkflowRule {
  readonly environment: string;
  /** A committed release of the same version in any one of these satisfies the rule. */
  readonly requiresPriorReleaseIn: readonly string[];
  readonly allowsDraftPublish: boolean;
  readonly allowsInBatch: boolean;
}

/** The revision in force and its rule per served environment. */
export interface EffectiveWorkflow {
  readonly revision: number | null;
  readonly source: "default" | "configured";
  readonly rules: readonly WorkflowRule[];
}

/**
 * The derived default, which is the deployment's behaviour with no revision written,
 * stated as data: `prod` needs a prior `test` release where `test` is served and refuses a
 * combined draft publish, every other destination needs nothing, and a batch may name any
 * of them. A prior release in the destination itself is the rollback exception rather than
 * a rule, so it is not listed here.
 */
export function defaultWorkflowRules(served: readonly string[]): WorkflowRule[] {
  const gated = usesTestWorkflow(served);
  return served.map((environment) => {
    const protectedTarget = gated && environment === PRODUCTION_ENVIRONMENT;
    return {
      environment,
      requiresPriorReleaseIn: protectedTarget ? ["test"] : [],
      allowsDraftPublish: !protectedTarget,
      allowsInBatch: true,
    };
  });
}

/** An environment the configured revision wrote no row for constrains nothing. */
const UNCONSTRAINED = {
  requiresPriorReleaseIn: [] as readonly string[],
  allowsDraftPublish: true,
  allowsInBatch: true,
} as const;

/**
 * The revision in force, read once per review and once per commit. No row means the
 * derived default rather than an empty rule set, which would permit everything.
 */
export async function readWorkflow(
  exec: Executor,
  served: readonly string[],
): Promise<EffectiveWorkflow> {
  const configured = await effectiveReleaseWorkflow(exec);
  if (configured === undefined) {
    return { revision: null, source: "default", rules: defaultWorkflowRules(served) };
  }
  const byName = new Map(configured.rules.map((rule) => [rule.environment, rule]));
  return {
    revision: configured.revision,
    source: "configured",
    rules: served.map((environment) => ({
      environment,
      ...(byName.get(environment) ?? UNCONSTRAINED),
    })),
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

export function testReleaseRequired(): ApiError {
  return new ApiError(
    "TEST_RELEASE_REQUIRED",
    409,
    "Publish and verify this version in test, then select prod and release the existing version.",
  );
}

/** The configured-revision refusal, naming the destination and what would satisfy it. */
export function priorReleaseRequired(environment: string, requiresAnyOf: readonly string[]): ApiError {
  return new ApiError(
    "PRIOR_RELEASE_REQUIRED",
    409,
    `The release workflow requires a prior release of this version in one of ` +
      `${requiresAnyOf.join(", ")} before ${environment}.`,
    { environment, requiresAnyOf: [...requiresAnyOf] },
  );
}

/** The refusal for freezing a draft and releasing it into a destination that forbids it. */
export function draftPublishNotAllowed(environment: string): ApiError {
  return new ApiError(
    "DRAFT_PUBLISH_NOT_ALLOWED",
    409,
    `The release workflow does not allow a new version to be frozen and released into ` +
      `${environment} in one act. Publish the version, then release it.`,
    { environment },
  );
}

/** The refusal for naming a destination the workflow keeps out of a multi-target act. */
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
    ? testReleaseRequired()
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
