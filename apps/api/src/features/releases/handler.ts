/**
 * Handlers for releases, promotion and the live environment set (ADR-40, task 065).
 *
 * Every route here runs on the **control** pool: a release record is control-plane state,
 * as is the version it names and the environment list it reads, and the one statement any
 * of this issues into a data schema is the `form.released` enqueue, which names its schema
 * explicitly (`release.ts`).
 *
 * What is deliberately absent:
 *
 *   - **No copy of anything.** Promotion is a record (R1, R6, ADR-18). Nothing here reads
 *     a definition, a compiled document or a version's content at all.
 *   - **No re-pin of a live session** (ADR-07, invariant I4, Q5). A release changes what a
 *     session started *after* it resolves, in that environment alone, and there is no
 *     write path here that could touch `sessions`: the control pool holds no privilege on
 *     that table in any environment.
 *   - **No re-pin of a live session** (ADR-07, invariant I4, Q5) - see above.
 *
 * **The approval rule arrived with task 070** (Q51). A release to `prod` in a workspace
 * whose `requireSecondApprover` switch is on is **one act** by a `forms.approver` who is
 * not the account that published the version, and the approving account is written to
 * `form_releases.approved_by` so the approval is a row somebody can read rather than a UI
 * step (`../membership/two-person.ts`). With the switch off, which is the default, nothing
 * is compared and nothing is written: the row is the row task 065 wrote.
 *
 * **The membership check is the middleware's** (task 069): `release: create` in the
 * environment the body names, with the matrix's production split meaning a `forms.editor`
 * holding `prod` in scope is still refused it. Nothing here re-asks that question.
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

// --- typed failures (envelope codes the admin app keys off) -----------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
  /** A review of the draft on a form that has none open. */
  draftNotFound: (): ApiError =>
    new ApiError("DRAFT_NOT_FOUND", 404, "This form has no open draft to review"),
  unknownEnvironment: (name: string): ApiError =>
    new ApiError("UNKNOWN_ENVIRONMENT", 400, `This deployment serves no environment named ${name}`),
  /**
   * The version named is already what is released there.
   *
   * A refusal rather than a second identical row, and the reason is the history rather
   * than the write: the record exists to answer "what was serving, and who put it there",
   * and a row that records no change - neither a move forward nor a rollback - is noise an
   * incident review has to read past. A double-pressed button is the ordinary way it
   * happens.
   *
   * It is **not** a claim that releasing an earlier version is refused: that is a rollback
   * and is the same act (ADR-40), and it succeeds.
   */
  alreadyReleased: (version: number, environment: string): ApiError =>
    new ApiError(
      "ALREADY_RELEASED",
      409,
      `Version ${version} is already the released version in ${environment}`,
    ),
  /**
   * Two releases into one environment raced, and this one lost.
   *
   * `insertFormRelease` assigns `sequence` with a scalar subquery and the composite
   * primary key `(form_id, environment, sequence)` is the backstop, so the loser of a
   * race violates that key. **Typed as a 409 rather than surfacing as a 500**: the
   * caller's request was well formed and the answer is "somebody else released first",
   * which is a conflict and is the caller's to repeat. There is **no automatic retry** -
   * there never was, and a release that silently re-ran would be a second audit row
   * nobody asked for - so the status is what tells the caller to read the history and
   * press again.
   */
  releaseRaced: (environment: string): ApiError =>
    new ApiError(
      "RELEASE_RACED",
      409,
      `Another release into ${environment} landed first; read the history and try again`,
    ),
  /**
   * No admin principal on a request that records an actor.
   *
   * A `500` rather than an empty `releasedBy`. The release record is the audit answer to
   * "who put that version into `prod`", and a row whose actor is `""` answers nothing
   * while looking like an answer. The admin-auth gate makes this unreachable in a
   * mounted process, which is why it throws rather than degrading.
   */
  noPrincipal: (): Error =>
    new Error("releases: no admin principal on a request that records an actor"),
} as const;

/** Whether a driver error is a unique-violation (23505), which here is the release key. */
function isReleaseKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/** Parse a `:id` path param to a FormId, or 400. */
function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * Refuse an environment this deployment does not serve, rather than defaulting one.
 *
 * `databases.names` is the set this process holds a pool for, which boot has reconciled
 * with `control.environments` (task 064, criterion 6a). Checked against that rather than
 * against the environments table so the answer cannot be "an environment exists but
 * nothing in this process can reach it".
 */
function requireEnvironment(deps: Deps, name: string): string {
  if (!deps.databases.names.includes(name)) throw fail.unknownEnvironment(name);
  return name;
}

/** The release row as the admin reads it, with the derived rollback reading. */
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
    // The intake state this row leaves behind (Q18, task 066). On the history because a
    // close and a reopen are rows here too, so a reader of "version 4, released by
    // Alice" needs to see which of the three acts it was.
    closed: row.closed,
  };
}

// --- POST /admin/forms/:id/releases -----------------------------------------

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

    // Both reads are on `control`: the form identity and the published version. A release
    // of a version that was never published is also refused by the composite foreign key,
    // and this read is what turns that into a 404 naming which half is missing.
    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();
    const version = await getFormVersion(deps.databases.control, formId, body.version);
    if (version === undefined) throw fail.versionNotFound();

    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();

    // **The two-person rule** (Q13, Q30, Q51; task 070), outside the transaction because
    // it is a refusal and costs no database work when it refuses. It answers the account
    // to record as the approver, or `undefined` when no approval was required - which is
    // every release outside `prod` and every release in a workspace whose switch is off.
    //
    // The author is the version's `published_by`: the account that **published** it, not
    // whoever last edited the draft (Q51). `version` was read above, so this costs no
    // extra round trip beyond the workspace read the switch needs.
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

    // **The `ALREADY_RELEASED` check runs inside the transaction**, with the read that
    // decides the response's `replacedVersion` and `rollback`. It was outside, which left
    // two windows rather than one convenience: a concurrent release could land between
    // the check and the write, so the refusal could pass on a version that was already
    // released by the time this row went in, and the response could report a
    // `replacedVersion` that had never been the current one. One transaction closes both
    // and costs no extra round trip, because the read was being made anyway.
    //
    // It is **not** the race guard. Two releases of *different* versions never meet this
    // check, and under `READ COMMITTED` neither sees the other's uncommitted row; the
    // composite primary key refuses the loser, and `releaseRaced` is how that reaches the
    // caller as a 409 rather than a 500.
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
          // The approval, on the release record, which is what makes it auditable rather
          // than procedural (ADR-41) and readable in the history (criterion 2). `undefined`
          // where none was required, so the column stays null exactly as task 065 left it.
          approvedBy,
          fromEnvironment,
          // Intake stays as it was: releasing a version into a closed environment does
          // not resume it (Q18). A first release has no current state and lands open.
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

// --- GET /admin/forms/:id/releases ------------------------------------------

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

// --- POST /admin/forms/:id/release-review -----------------------------------

/**
 * What releasing one source into each environment the caller may release into would do
 * (decision 5's read half, Q89; Code Owner, 2026-10-29).
 *
 * # Stateless, and that is the decision rather than a simplification
 *
 * There is no review token, no stored candidate and no row of any kind: the commit
 * (phase 3) carries the caller's expectations and rechecks everything inside its
 * transaction, so a review is a **report** and never a reservation. A stored review would
 * be a second source of truth about release eligibility, and the one that the commit did
 * not read.
 *
 * # Why the targets are filtered here and not by a route row
 *
 * The row is `release: read`, which names no environment, because this handler acts in
 * none. What it reports per environment is filtered by `release: create` **in that
 * environment**, asked of the same {@link decideAccess} the middleware uses - so an editor
 * scoped to `test` is told about `test`, an approver scoped to `prod` about `prod`, and
 * neither learns anything about the other's target. That is the Q7 erasure-scope shape:
 * the environments an offer is made for are each decided before the offer is made.
 *
 * # Evidence and blockers on the default workflow
 *
 * The configuration table is phase 3's, so this reads the **derived default** (decision 1
 * stated as data): `prod` requires a prior release of that version in `test` or `prod`
 * when both are served, a combined draft publish into `prod` is refused there, and every
 * other environment has no prerequisite. Evidence is the committed rows that satisfied it,
 * and the blocker code stays `TEST_RELEASE_REQUIRED` until a revision is written (F5), so
 * the existing client's handling of that code keeps working.
 *
 * The **rollback exception** is decision 2's: a version with any prior release row in the
 * target itself is eligible there regardless of prerequisites, and the two-person rule
 * still applies to it.
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
    const requiresSecond = workspace?.requireSecondApprover ?? false;
    // The canonical order (Q42), narrowed to the pools this process holds, so the review
    // lists targets in the order every other environment list uses.
    const rows = await listEnvironments(exec);
    const served = rows
      .map((row) => row.name)
      .filter((name) => deps.databases.names.includes(name));

    const targets = [];
    for (const environment of served) {
      const mayRelease = decideAccess({
        memberRole: membership.memberRole,
        grants: membership.grants,
        request: { resource: "release", action: "create", environment, formId },
      }).allowed;
      if (!mayRelease) continue;

      const here = releases.filter((release) => release.environment === environment);
      // Newest first already (`listFormReleases` orders by released_at then sequence).
      const current = here[0];
      const version = candidate?.version;
      const rollback =
        version !== undefined && here.some((release) => release.version === version);
      const prerequisite =
        workflowEnabled && environment === PRODUCTION_ENVIRONMENT ? ["test", "prod"] : [];
      const evidence =
        version === undefined
          ? []
          : releases.filter(
              (release) =>
                release.version === version &&
                (prerequisite.length === 0
                  ? release.environment === environment
                  : prerequisite.includes(release.environment)),
            );

      const blockers: { code: string; requiresAnyOf: string[] }[] = [];
      if (prerequisite.length > 0 && !rollback) {
        if (source.kind === "draft") {
          // Today's behaviour, stated: a combined publish into `prod` is refused while
          // `test` is served, because the version would have no prior release anywhere.
          blockers.push({ code: "DRAFT_PUBLISH_NOT_ALLOWED", requiresAnyOf: [...prerequisite] });
        } else if (evidence.length === 0) {
          blockers.push({ code: "TEST_RELEASE_REQUIRED", requiresAnyOf: [...prerequisite] });
        }
      }
      if (version !== undefined && current?.version === version) {
        blockers.push({ code: "ALREADY_RELEASED", requiresAnyOf: [] });
      }

      const applies = environment === PRODUCTION_ENVIRONMENT && requiresSecond;
      const author = candidate?.publishedBy ?? null;
      const refusedAsAuthor = applies && author !== null && author === principal.userId;
      if (applies && source.kind === "version") {
        if (author === null) blockers.push({ code: "APPROVER_UNKNOWN_AUTHOR", requiresAnyOf: [] });
        else if (refusedAsAuthor) blockers.push({ code: "APPROVER_IS_AUTHOR", requiresAnyOf: [] });
      }

      targets.push({
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
      });
    }

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
        // Null until phase 3 writes a revision (decision 1): a deployment with no row
        // keeps exactly today's derived behaviour and says so rather than reporting a
        // revision nobody wrote.
        workflowRevision: null,
        workflowSource: "default" as const,
        targets,
      },
      200,
    );
  };
}

// --- GET /admin/environments ------------------------------------------------

export function makeEnvironmentSetHandler(
  deps: Deps,
): RouteHandler<typeof environmentSetRoute, ApiEnv> {
  return async (c) => {
    // The environments table is the source of the set, and `position` is the canonical
    // order (Q42), so the switcher's order is the same order a combined environment set is
    // written in everywhere else. Intersected with the pools this process actually holds,
    // because an environment with no credential here is one no screen could read: boot
    // refuses that disagreement (task 064, criterion 6a), and the intersection is what
    // keeps this read honest if the boot check is ever made non-fatal.
    const rows = await listEnvironments(deps.databases.control);
    const served = rows.filter((row) => deps.databases.names.includes(row.name));

    // **Narrowed to the environments the caller holds in some grant** (Q25, task 069).
    // The ruling's own words are that the Q6 switcher offers only those, and the API is
    // where that happens rather than the admin: a switcher is one client of this route,
    // and a second client reading the whole set would see round a narrowing done in the
    // first. The installation claim is served the set whole, because administering
    // environments across every workspace is what the claim is for (Q29), and a caller
    // holding neither a grant nor the claim gets an empty list - which is the same
    // "reaches nothing" every other refusal gives them, in the shape this route has.
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
 * The environments one caller holds in some grant, with `all` expanded against the live
 * set (Q25).
 *
 * A set rather than a list, because the only question asked of it is membership, and the
 * **order** of the answer is the environments table's: the caller's grants decide which
 * rows survive and never the order they come back in, which is what keeps a combined
 * environment set spelled one way everywhere (Q42).
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
