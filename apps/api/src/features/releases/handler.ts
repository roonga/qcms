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
 *   - **No approval rule.** The `approvedBy` column is written by task 070's two-person
 *     rule for `prod` (Q51). This task records the column and enforces nothing.
 *   - **No membership check.** These screens are not gated by a workspace role, because
 *     the role and its scope arrive with tasks 068 and 069; adding a check before they
 *     exist would be inventing it.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  getForm,
  getFormVersion,
  getReleasedVersion,
  listCurrentReleases,
  listEnvironments,
  listFormReleases,
} from "@roonga/qcms-db";
import type { FormReleaseHistoryRow } from "@roonga/qcms-db";

import { FormId, parseFormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { recordRelease } from "./release.js";
import type {
  currentReleasesRoute,
  environmentSetRoute,
  releaseHistoryRoute,
  releaseVersionRoute,
} from "./route.js";

// --- typed failures (envelope codes the admin app keys off) -----------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
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
} as const;

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

    const current = await getReleasedVersion(deps.databases.control, formId, environment);
    if (current?.version === body.version) {
      throw fail.alreadyReleased(body.version, environment);
    }

    const principal = c.get("adminPrincipal");
    const release = await deps.databases.control.transaction((tx) =>
      recordRelease(tx, {
        formId,
        environment,
        version: body.version,
        releasedBy: principal?.userId ?? "",
        fromEnvironment,
      }),
    );

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

// --- GET /admin/releases ----------------------------------------------------

export function makeCurrentReleasesHandler(
  deps: Deps,
): RouteHandler<typeof currentReleasesRoute, ApiEnv> {
  return async (c) => {
    const { environment } = c.req.valid("query");
    if (environment !== undefined) requireEnvironment(deps, environment);

    const releases = await listCurrentReleases(deps.databases.control, environment);
    return c.json(
      {
        releases: releases.map((row) => ({
          formId: row.formId,
          environment: row.environment,
          version: row.version,
          releasedAt: row.releasedAt.toISOString(),
          releasedBy: row.releasedBy,
        })),
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
    return c.json(
      {
        environments: rows
          .filter((row) => deps.databases.names.includes(row.name))
          .map((row) => ({ name: row.name, position: row.position })),
      },
      200,
    );
  };
}
