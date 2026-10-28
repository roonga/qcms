/**
 * A release is a record and copies nothing, and nothing here can re-pin a live session:
 * the control pool holds no privilege on `sessions` in any environment.
 *
 * The membership check is the middleware's (`release: create` in the environment the body
 * names), and nothing here re-asks it.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  getForm,
  getFormVersion,
  getReleasedVersion,
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
import { holdsInstallationClaim } from "../membership/resolver.js";
import { approvalForRelease } from "../membership/two-person.js";
import { recordRelease } from "./release.js";
import { requireProductionCandidate } from "./workflow.js";
import type { environmentSetRoute, releaseHistoryRoute, releaseVersionRoute } from "./route.js";

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
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

    // The `ALREADY_RELEASED` check shares the transaction with the read that decides
    // `replacedVersion` and `rollback`, so a concurrent release cannot land between them.
    // It is not the race guard: the composite primary key refuses the loser and
    // `releaseRaced` turns that into a 409.
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
