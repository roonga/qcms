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
  getReleasedVersion,
  getWorkspace,
  isScopeAll,
  listEnvironmentNames,
  listEnvironments,
  listFormReleases,
  listGrantsForUser,
} from "@roonga/qcms-db";
import type { Executor, FormReleaseHistoryRow } from "@roonga/qcms-db";

import { FormId, parseFormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { decideAccess, PRODUCTION_ENVIRONMENT } from "../membership/policy.js";
import { holdsInstallationClaim, resolveGrants } from "../membership/resolver.js";
import { approvalForRelease } from "../membership/two-person.js";
import { recordRelease } from "./release.js";
import { requireProductionCandidate, usesTestWorkflow } from "./workflow.js";
import type {
  environmentSetRoute,
  releaseHistoryRoute,
  releaseReviewRoute,
  releaseVersionRoute,
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

    await requireProductionCandidate(
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
    if (source.kind === "draft" && (await getDraft(exec, formId)) === undefined) {
      throw fail.draftNotFound();
    }

    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    const workspaceId = c.get("grantContext")?.workspaceId ?? form.workspaceId;
    const membership = await resolveGrants(exec, {
      userId: principal.userId,
      workspaceId,
      claim: holdsInstallationClaim(principal.role),
    });

    const releases = await listFormReleases(exec, formId);
    const workflowEnabled = usesTestWorkflow(deps.databases.names);
    const workspace = await getWorkspace(exec, workspaceId);
    const rows = await listEnvironments(exec);
    const served = rows.map((row) => row.name).filter((name) => deps.databases.names.includes(name));

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
          workflowEnabled,
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
            ? ({ kind: "draft" } as const)
            : ({
                kind: "version" as const,
                version: source.version,
                publishedBy: candidate?.publishedBy ?? null,
              } as const),
        workflowRevision: null,
        workflowSource: "default" as const,
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
  readonly workflowEnabled: boolean;
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
  const here = releases.filter((release) => release.environment === environment);
  const current = here[0];
  // A version already released in the target itself is a rollback, eligible regardless of
  // prerequisites.
  const rollback = version !== undefined && here.some((release) => release.version === version);
  const prerequisite =
    input.workflowEnabled && environment === PRODUCTION_ENVIRONMENT ? ["test", "prod"] : [];
  const evidence =
    version === undefined ? [] : evidenceFor(releases, version, environment, prerequisite);

  const applies = environment === PRODUCTION_ENVIRONMENT && input.requiresSecond;
  const refusedAsAuthor = applies && input.author !== null && input.author === input.caller;
  const blockers = blockersFor({
    prerequisite,
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
  if (input.prerequisite.length > 0 && !input.rollback) {
    // A combined publish into a target with a prerequisite is refused: the version would
    // have no prior release anywhere.
    if (input.isDraft) blockers.push({ code: "DRAFT_PUBLISH_NOT_ALLOWED", requiresAnyOf });
    else if (!input.hasEvidence) blockers.push({ code: "TEST_RELEASE_REQUIRED", requiresAnyOf });
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

/**
 * The committed rows that satisfy a target's rule: rows in a required environment, or,
 * with no prerequisite, rows in the target itself, which is what marks a rollback.
 */
function evidenceFor(
  releases: readonly FormReleaseHistoryRow[],
  version: number,
  environment: string,
  prerequisite: readonly string[],
): FormReleaseHistoryRow[] {
  return releases.filter((release) => {
    if (release.version !== version) return false;
    return prerequisite.length === 0
      ? release.environment === environment
      : prerequisite.includes(release.environment);
  });
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
