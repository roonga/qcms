/**
 * A release is a record and copies nothing; the control pool holds no privilege on
 * `sessions`, so nothing here can re-pin a live session. The membership check is the
 * middleware's.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  getDraft,
  getForm,
  getFormVersion,
  getReleaseBatch,
  getReleasedVersion,
  getWorkspace,
  insertReleaseWorkflowRevision,
  isScopeAll,
  latestReleaseWorkflowRevision,
  listActiveWorkspaces,
  listEnvironmentNames,
  listEnvironments,
  listFormReleases,
  listGrantsForUser,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { Executor, FormReleaseHistoryRow } from "@roonga/qcms-db";

import { FormId, parseFormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { decideAccess, PRODUCTION_ENVIRONMENT } from "../membership/policy.js";
import { holdsInstallationClaim, resolveGrants } from "../membership/resolver.js";
import { approvalForRelease } from "../membership/two-person.js";
import { commitReleaseBatch, intentHashOf, type BatchResult } from "./batch.js";
import { recordRelease } from "./release.js";
import {
  evidenceFor,
  isRollback,
  prerequisiteCode,
  readWorkflow,
  requireReleaseCandidate,
  ruleFor,
  type EffectiveWorkflow,
} from "./workflow.js";
import type {
  environmentSetRoute,
  releaseBatchLookupRoute,
  releaseBatchRoute,
  releaseHistoryRoute,
  releaseReviewRoute,
  releaseVersionRoute,
  releaseWorkflowReadRoute,
  releaseWorkflowWriteRoute,
} from "./route.js";

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
  draftNotFound: (): ApiError =>
    new ApiError("DRAFT_NOT_FOUND", 404, "This form has no open draft to review"),
  unknownEnvironment: (name: string): ApiError =>
    new ApiError("UNKNOWN_ENVIRONMENT", 400, `This deployment serves no environment named ${name}`),
  /**
   * A refusal rather than a second identical row, so the history that answers "what was
   * serving, and who put it there" holds no row that records no change. Releasing an
   * earlier version is a rollback and still succeeds.
   */
  alreadyReleased: (version: number, environment: string): ApiError =>
    new ApiError(
      "ALREADY_RELEASED",
      409,
      `Version ${version} is already the released version in ${environment}`,
    ),
  /**
   * The loser of a race violates the composite primary key. A 409 rather than a 500
   * because the request was well formed, and there is no retry: a silent re-run would be
   * an audit row nobody asked for.
   */
  releaseRaced: (environment: string): ApiError =>
    new ApiError(
      "RELEASE_RACED",
      409,
      `Another release into ${environment} landed first; read the history and try again`,
    ),
  /**
   * A 500 rather than an empty `releasedBy`, which would answer nothing while looking
   * like an answer. The admin-auth gate makes it unreachable in a mounted process.
   */
  noPrincipal: (): Error =>
    new Error("releases: no admin principal on a request that records an actor"),
  invalidSource: (): ApiError =>
    new ApiError(
      "INVALID_SOURCE_ENVIRONMENT",
      400,
      "A promotion comes from another environment; omit the source for a first release",
    ),
  /** Not "gone": only successes are stored, so the same key may be resent. */
  batchNotFound: (): ApiError =>
    new ApiError(
      "RELEASE_BATCH_NOT_FOUND",
      404,
      "No confirmation with that key committed for this form and account; resend the same key",
    ),
  workflowRevisionStale: (): ApiError =>
    new ApiError(
      "WORKFLOW_REVISION_STALE",
      409,
      "Another account wrote a release-workflow revision first; read the configuration again",
    ),
  workflowRuleInvalid: (environment: string, reason: string): ApiError =>
    new ApiError("WORKFLOW_RULE_INVALID", 400, `${environment}: ${reason}`, {
      environment,
      reason,
    }),
} as const;

function isReleaseKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * Checked against the pools this process holds rather than against `control.environments`,
 * so the answer cannot be "it exists but nothing here can reach it".
 */
function requireEnvironment(deps: Deps, name: string): string {
  if (!deps.databases.names.includes(name)) throw fail.unknownEnvironment(name);
  return name;
}

function releaseBody(row: FormReleaseHistoryRow): {
  formId: string;
  environment: string;
  version: number;
  sequence: number;
  fromEnvironment: string | null;
  releasedBy: string;
  releasedAt: string;
  approvedBy: string | null;
  replacedVersion: number | null;
  rollback: boolean;
  closed: boolean;
} {
  return {
    formId: row.formId,
    environment: row.environment,
    version: row.version,
    sequence: row.sequence,
    fromEnvironment: row.fromEnvironment,
    releasedBy: row.releasedBy,
    releasedAt: row.releasedAt.toISOString(),
    approvedBy: row.approvedBy,
    replacedVersion: row.replacedVersion,
    rollback: row.rollback,
    // On the history because a close and a reopen are rows here too, so a reader needs to
    // see which of the three acts a row was.
    closed: row.closed,
  };
}

export function makeReleaseVersionHandler(
  deps: Deps,
): RouteHandler<typeof releaseVersionRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    const environment = requireEnvironment(deps, body.environment);
    const fromEnvironment =
      body.fromEnvironment === undefined
        ? undefined
        : requireEnvironment(deps, body.fromEnvironment);
    // The `form_releases_from_other_environment` CHECK refuses this too; refusing it here
    // is what makes the answer a 400 with a message rather than a constraint violation.
    if (fromEnvironment === environment) {
      throw new ApiError(
        "INVALID_SOURCE_ENVIRONMENT",
        400,
        "A promotion comes from another environment; omit the source for a first release",
      );
    }

    // The composite foreign key refuses an unpublished version too; these reads are what
    // turn that into a 404 naming which half is missing.
    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();
    const version = await getFormVersion(deps.databases.control, formId, body.version);
    if (version === undefined) throw fail.versionNotFound();

    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();

    // Outside the transaction, so a refusal costs no database work. The author compared
    // against is the version's `published_by`, not whoever last edited the draft.
    const approvedBy = await approvalForRelease(deps.databases.control, {
      workspaceId: c.get("grantContext")?.workspaceId ?? form.workspaceId,
      environment,
      version: body.version,
      author: version.publishedBy,
      releasedBy: principal.userId,
    });

    await requireReleaseCandidate(
      deps.databases.control,
      deps.databases.names,
      environment,
      formId,
      body.version,
    );

    // `ALREADY_RELEASED` shares the transaction with the read deciding `replacedVersion` and
    // `rollback`. The race guard is the composite primary key, which `releaseRaced` maps to 409.
    let current: Awaited<ReturnType<typeof getReleasedVersion>>;
    let release: Awaited<ReturnType<typeof recordRelease>>;
    try {
      release = await deps.databases.control.transaction(async (tx) => {
        current = await getReleasedVersion(tx, formId, environment);
        if (current?.version === body.version) {
          throw fail.alreadyReleased(body.version, environment);
        }
        return recordRelease(tx, {
          formId,
          environment,
          version: body.version,
          releasedBy: principal.userId,
          // On the record, which is what makes the approval auditable rather than
          // procedural; `undefined` where none was required.
          approvedBy,
          fromEnvironment,
          // Releasing into a closed environment does not resume intake.
          closed: current?.closed ?? false,
        });
      });
    } catch (error) {
      if (isReleaseKeyViolation(error)) throw fail.releaseRaced(environment);
      throw error;
    }

    return c.json(
      {
        release: {
          ...releaseBody({
            ...release,
            replacedVersion: current?.version ?? null,
            rollback: current !== undefined && current.version > release.version,
          }),
        },
        version: release.version,
      },
      200,
    );
  };
}

export function makeReleaseHistoryHandler(
  deps: Deps,
): RouteHandler<typeof releaseHistoryRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const { environment } = c.req.valid("query");
    if (environment !== undefined) requireEnvironment(deps, environment);

    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    const releases = await listFormReleases(deps.databases.control, formId, environment);
    return c.json({ releases: releases.map((row) => releaseBody(row)) }, 200);
  };
}

/**
 * What releasing one source into each permitted target would do. It writes nothing: the
 * review is a report rather than a reservation, and the commit rechecks every expectation.
 *
 * The route names no environment because this acts in none; the targets reported are the
 * ones the caller holds `release: create` in, decided per environment here.
 */
export function makeReleaseReviewHandler(
  deps: Deps,
): RouteHandler<typeof releaseReviewRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const { source } = c.req.valid("json");

    const exec = deps.databases.control;
    const form = await getForm(exec, formId);
    if (form === undefined) throw fail.formNotFound();

    const candidate =
      source.kind === "version" ? await getFormVersion(exec, formId, source.version) : undefined;
    if (source.kind === "version" && candidate === undefined) throw fail.versionNotFound();
    const draft = source.kind === "draft" ? await getDraft(exec, formId) : undefined;
    if (source.kind === "draft" && draft === undefined) throw fail.draftNotFound();

    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    const workspaceId = c.get("grantContext")?.workspaceId ?? form.workspaceId;
    const membership = await resolveGrants(exec, {
      userId: principal.userId,
      workspaceId,
      claim: holdsInstallationClaim(principal.role),
    });

    const releases = await listFormReleases(exec, formId);
    const workspace = await getWorkspace(exec, workspaceId);
    const rows = await listEnvironments(exec);
    const served = rows
      .map((row) => row.name)
      .filter((name) => deps.databases.names.includes(name));
    const workflow = await readWorkflow(exec, served);

    const targets = served
      .filter(
        (environment) =>
          decideAccess({
            memberRole: membership.memberRole,
            grants: membership.grants,
            request: { resource: "release", action: "create", environment, formId },
          }).allowed,
      )
      .map((environment) =>
        reviewTarget({
          environment,
          releases,
          workflow,
          requiresSecond: workspace?.requireSecondApprover ?? false,
          isDraft: source.kind === "draft",
          version: candidate?.version,
          author: candidate?.publishedBy ?? null,
          caller: principal.userId,
        }),
      );

    return c.json(
      {
        source:
          source.kind === "draft"
            ? ({ kind: "draft" as const, draftRevision: draft!.revision } as const)
            : ({
                kind: "version" as const,
                version: source.version,
                publishedBy: candidate?.publishedBy ?? null,
              } as const),
        workflowRevision: workflow.revision,
        workflowSource: workflow.source,
        targets,
      },
      200,
    );
  };
}

interface Blocker {
  readonly code: string;
  readonly requiresAnyOf: string[];
}

/**
 * One target of a review: what is serving, the evidence and the two-person reading.
 * Nothing here reads a grant; the handler has already chosen the targets.
 */
function reviewTarget(input: {
  readonly environment: string;
  readonly releases: readonly FormReleaseHistoryRow[];
  readonly workflow: EffectiveWorkflow;
  readonly requiresSecond: boolean;
  readonly isDraft: boolean;
  readonly version: number | undefined;
  readonly author: string | null;
  readonly caller: string;
}): {
  environment: string;
  currentVersion: number | null;
  currentSequence: number | null;
  closed: boolean;
  evidence: { environment: string; version: number; sequence: number; releasedAt: string }[];
  blockers: Blocker[];
  twoPerson: { applies: boolean; refusedAsAuthor: boolean };
  protected: boolean;
} {
  const { environment, releases, version } = input;
  const current = releases.find((release) => release.environment === environment);
  const rule = ruleFor(input.workflow, environment);
  // A version already released in the target itself is a rollback, eligible regardless of
  // prerequisites.
  const rollback = version !== undefined && isRollback(releases, environment, version);
  const evidence =
    version === undefined ? [] : evidenceFor(releases, { version, environment, rule });

  const applies = environment === PRODUCTION_ENVIRONMENT && input.requiresSecond;
  const refusedAsAuthor = applies && input.author !== null && input.author === input.caller;
  const blockers = blockersFor({
    prerequisite: rule.requiresPriorReleaseIn,
    prerequisiteCode: prerequisiteCode(input.workflow),
    allowsDraftPublish: rule.allowsDraftPublish,
    rollback,
    isDraft: input.isDraft,
    hasEvidence: evidence.length > 0,
    alreadyReleased: version !== undefined && current?.version === version,
    twoPersonApplies: applies,
    authorKnown: input.author !== null,
    refusedAsAuthor,
  });

  return {
    environment,
    currentVersion: current?.version ?? null,
    currentSequence: current?.sequence ?? null,
    closed: current?.closed ?? false,
    evidence: evidence.map((release) => ({
      environment: release.environment,
      version: release.version,
      sequence: release.sequence,
      releasedAt: release.releasedAt.toISOString(),
    })),
    blockers,
    twoPerson: { applies, refusedAsAuthor },
    protected: environment === PRODUCTION_ENVIRONMENT,
  };
}

/** Every reason one target refuses one candidate, from conditions already decided. */
function blockersFor(input: {
  readonly prerequisite: readonly string[];
  readonly prerequisiteCode: string;
  readonly allowsDraftPublish: boolean;
  readonly rollback: boolean;
  readonly isDraft: boolean;
  readonly hasEvidence: boolean;
  readonly alreadyReleased: boolean;
  readonly twoPersonApplies: boolean;
  readonly authorKnown: boolean;
  readonly refusedAsAuthor: boolean;
}): Blocker[] {
  const blockers: Blocker[] = [];
  const requiresAnyOf = [...input.prerequisite];
  if (input.isDraft && !input.allowsDraftPublish) {
    blockers.push({ code: "DRAFT_PUBLISH_NOT_ALLOWED", requiresAnyOf });
  } else if (input.prerequisite.length > 0 && !input.rollback) {
    // A version frozen in this act has reached no environment, so a destination with a
    // prerequisite cannot be satisfied by anything.
    if (input.isDraft || !input.hasEvidence) {
      blockers.push({ code: input.prerequisiteCode, requiresAnyOf });
    }
  }
  if (input.alreadyReleased) blockers.push({ code: "ALREADY_RELEASED", requiresAnyOf: [] });
  if (input.twoPersonApplies && !input.isDraft) {
    if (!input.authorKnown) blockers.push({ code: "APPROVER_UNKNOWN_AUTHOR", requiresAnyOf: [] });
    else if (input.refusedAsAuthor) {
      blockers.push({ code: "APPROVER_IS_AUTHOR", requiresAnyOf: [] });
    }
  }
  return blockers;
}

export function makeEnvironmentSetHandler(
  deps: Deps,
): RouteHandler<typeof environmentSetRoute, ApiEnv> {
  return async (c) => {
    // Intersected with the pools this process holds, because an environment with no
    // credential here is one no screen could read; boot refuses that disagreement, and the
    // intersection keeps this read honest if that check is ever made non-fatal.
    const rows = await listEnvironments(deps.databases.control);
    const served = rows.filter((row) => deps.databases.names.includes(row.name));

    // Narrowed here rather than in the admin, so a second client of this route cannot see
    // round the narrowing. The installation claim is served the set whole, and a caller
    // holding neither a grant nor the claim gets an empty list.
    const principal = c.get("adminPrincipal");
    const claim = holdsInstallationClaim(principal?.role);
    const held = claim
      ? undefined
      : await heldEnvironments(deps.databases.control, principal?.userId);

    return c.json(
      {
        environments: served
          .filter((row) => held === undefined || held.has(row.name))
          .map((row) => ({ name: row.name, position: row.position })),
      },
      200,
    );
  };
}

/**
 * A set rather than a list: the caller's grants decide which rows survive and never the
 * order they come back in, which stays the environments table's.
 */
async function heldEnvironments(
  exec: Executor,
  userId: string | undefined,
): Promise<ReadonlySet<string>> {
  if (userId === undefined) return new Set();
  const [grants, live] = await Promise.all([
    listGrantsForUser(exec, userId),
    listEnvironmentNames(exec),
  ]);
  const held = new Set<string>();
  for (const grant of grants) {
    if (isScopeAll(grant.environments)) for (const name of live) held.add(name);
    else for (const name of grant.environments) held.add(name);
  }
  return held;
}

/** The rule set as the configuration reads and writes it. */
type RuleInput = {
  readonly environment: string;
  readonly requiresPriorReleaseIn: readonly string[];
  readonly allowsDraftPublish: boolean;
  readonly allowsInBatch: boolean;
};

/**
 * The configuration as both routes answer it: every served environment with the rule in
 * force, the derived default included, so a publisher reads the rule rather than inferring
 * it from whether a table has rows.
 */
function workflowBody(
  workflow: EffectiveWorkflow,
  rows: readonly { readonly name: string; readonly position: number }[],
): {
  revision: number | null;
  source: "default" | "configured";
  environments: {
    name: string;
    position: number;
    protected: boolean;
    requiresPriorReleaseIn: string[];
    allowsDraftPublish: boolean;
    allowsInBatch: boolean;
  }[];
} {
  return {
    revision: workflow.revision,
    source: workflow.source,
    environments: rows.map((row) => {
      const rule = ruleFor(workflow, row.name);
      return {
        name: row.name,
        position: row.position,
        // Read-only: it reports the role split and the workspace second-approver switch,
        // which no rule here can alter.
        protected: row.name === PRODUCTION_ENVIRONMENT,
        requiresPriorReleaseIn: [...rule.requiresPriorReleaseIn],
        allowsDraftPublish: rule.allowsDraftPublish,
        allowsInBatch: rule.allowsInBatch,
      };
    }),
  };
}

async function servedEnvironments(
  deps: Deps,
): Promise<{ readonly name: string; readonly position: number }[]> {
  const rows = await listEnvironments(deps.databases.control);
  return rows
    .filter((row) => deps.databases.names.includes(row.name))
    .map((row) => ({ name: row.name, position: row.position }));
}

export function makeReleaseWorkflowReadHandler(
  deps: Deps,
): RouteHandler<typeof releaseWorkflowReadRoute, ApiEnv> {
  return async (c) => {
    const rows = await servedEnvironments(deps);
    const workflow = await readWorkflow(
      deps.databases.control,
      rows.map((row) => row.name),
    );
    return c.json(workflowBody(workflow, rows), 200);
  };
}

/**
 * Write the next revision. Nothing here renames an environment, creates one or moves
 * `prod` out of its protected role: every name is checked against the served set and the
 * rules are validated as an acyclic graph before anything is written.
 */
export function makeReleaseWorkflowWriteHandler(
  deps: Deps,
): RouteHandler<typeof releaseWorkflowWriteRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();

    const exec = deps.databases.control;
    const rows = await servedEnvironments(deps);
    validateWorkflowRules(
      body.rules,
      rows.map((row) => row.name),
    );

    await exec.transaction(async (tx) => {
      const current = await latestReleaseWorkflowRevision(tx);
      if ((current ?? null) !== body.expectedRevision) throw fail.workflowRevisionStale();
      const revision = await insertReleaseWorkflowRevision(tx, {
        createdBy: principal.userId,
        note: body.note ?? null,
        rules: body.rules.map((rule) => ({ ...rule })),
        createdAt: deps.clock.now(),
      });
      // Installation-wide, so the row lands in every workspace's audit: the rule governs
      // what each of them may release, and an owner reading a refused release needs the
      // reason to be readable from the workspace the refusal happened in.
      for (const workspace of await listActiveWorkspaces(tx)) {
        await writeAccessAuditRow(tx, {
          actor: principal.userId,
          workspaceId: workspace.id,
          kind: "setting",
          detail:
            `setting=releaseWorkflow value=revision ${String(revision.revision)}; ` +
            ruleSummary(body.rules),
          occurredAt: deps.clock.now(),
        });
      }
    });

    const workflow = await readWorkflow(
      exec,
      rows.map((row) => row.name),
    );
    return c.json(workflowBody(workflow, rows), 200);
  };
}

/** A compact summary for the audit detail. It carries no URL, no secret and no content. */
function ruleSummary(rules: readonly RuleInput[]): string {
  if (rules.length === 0) return "rules=none";
  return rules
    .map(
      (rule) =>
        `${rule.environment}:after=${
          rule.requiresPriorReleaseIn.length === 0 ? "-" : rule.requiresPriorReleaseIn.join("+")
        },draft=${String(rule.allowsDraftPublish)},batch=${String(rule.allowsInBatch)}`,
    )
    .join(" ");
}

/**
 * Every name served, no destination requiring itself, no duplicate row and no cycle.
 * Rollback is the ruled exception rather than a rule, so a self-reference is a defect in
 * the configuration and not a way to express one.
 */
function validateWorkflowRules(rules: readonly RuleInput[], served: readonly string[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!served.includes(rule.environment)) {
      throw fail.workflowRuleInvalid(
        rule.environment,
        "this deployment serves no environment of that name",
      );
    }
    if (seen.has(rule.environment)) throw fail.workflowRuleInvalid(rule.environment, "named twice");
    seen.add(rule.environment);
    for (const required of rule.requiresPriorReleaseIn) {
      if (required === rule.environment) {
        throw fail.workflowRuleInvalid(
          rule.environment,
          "cannot require a prior release in itself; releasing a version it already served " +
            "is a rollback and is eligible anyway",
        );
      }
      if (!served.includes(required)) {
        throw fail.workflowRuleInvalid(
          rule.environment,
          `requires a prior release in ${required}, which this deployment does not serve`,
        );
      }
    }
  }
  const cycle = findCycle(rules);
  if (cycle !== undefined) {
    throw fail.workflowRuleInvalid(cycle, "is on a cycle, so no version could ever reach it");
  }
}

/** The first environment found on a cycle of prerequisite edges. */
function findCycle(rules: readonly RuleInput[]): string | undefined {
  const edges = new Map(rules.map((rule) => [rule.environment, rule.requiresPriorReleaseIn]));
  const state = new Map<string, "open" | "done">();
  const walk = (node: string): string | undefined => {
    const seen = state.get(node);
    if (seen === "done") return undefined;
    if (seen === "open") return node;
    state.set(node, "open");
    for (const next of edges.get(node) ?? []) {
      const found = walk(next);
      if (found !== undefined) return found;
    }
    state.set(node, "done");
    return undefined;
  };
  for (const rule of rules) {
    const found = walk(rule.environment);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Release one existing version into every named destination in one transaction.
 * Authorisation is the route's: the middleware evaluates `release: create` once per listed
 * environment, so one request environment cannot authorise the others.
 */
export function makeReleaseBatchHandler(
  deps: Deps,
): RouteHandler<typeof releaseBatchRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    for (const target of body.targets) {
      requireEnvironment(deps, target.environment);
      if (target.fromEnvironment !== undefined) {
        requireEnvironment(deps, target.fromEnvironment);
        if (target.fromEnvironment === target.environment) throw fail.invalidSource();
      }
    }

    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();
    const version = await getFormVersion(deps.databases.control, formId, body.source.version);
    if (version === undefined) throw fail.versionNotFound();

    const result = await commitReleaseBatch(deps, {
      formId,
      workspaceId: c.get("grantContext")?.workspaceId ?? form.workspaceId,
      principalId: principal.userId,
      idempotencyKey: body.idempotencyKey,
      intentHash: await intentHashOf(body),
      expectedWorkflowRevision: body.expectedWorkflowRevision,
      source: { kind: "version", version: body.source.version, publishedBy: version.publishedBy },
      targets: body.targets.map((target) => ({
        environment: target.environment,
        expectedSequence: target.expectedSequence,
        ...(target.fromEnvironment === undefined
          ? {}
          : { fromEnvironment: target.fromEnvironment }),
      })),
    });
    return c.json(result, 200);
  };
}

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The stored result of one confirmation, for a client that lost its answer. A 404 means
 * "not committed, resend the same key" rather than "gone": only successes are stored, and
 * the release history is the long-term answer.
 */
export function makeReleaseBatchLookupHandler(
  deps: Deps,
): RouteHandler<typeof releaseBatchLookupRoute, ApiEnv> {
  return async (c) => {
    const { id, key } = c.req.valid("param");
    const formId = requireFormId(id);
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    if (!UUID_KEY.test(key)) throw fail.batchNotFound();

    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    // Keyed on the principal as well as the form, so another account cannot read a result
    // it did not create.
    const stored = await getReleaseBatch(deps.databases.control, {
      principalId: principal.userId,
      formId,
      idempotencyKey: key,
    });
    if (stored === undefined) throw fail.batchNotFound();
    return c.json(stored.result as BatchResult, 200);
  };
}
