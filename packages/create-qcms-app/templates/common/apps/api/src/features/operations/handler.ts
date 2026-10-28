/**
 * Operations discovery: the authorised read model for one environment (decision 3 / Q87
 * and Q91, Code Owner 2026-10-29; `plan/environment-phase1-decisions.md`).
 *
 * # The shape of the answer, and why it is assembled rather than queried
 *
 * Five grants reach this route and each sees a different projection of a different subset
 * of forms, with the subsets overlapping (D3's "combined grants" row). No single SQL
 * predicate expresses that: the form scope on a `responses.*` grant is a per-form list,
 * the production split is a property of the matrix rather than of a scope, and
 * `form: read` is workspace-wide while `response: read` is not. So the authorisation is
 * {@link decideAccess}, asked per (form, cell, environment) against the grants the **grant
 * middleware already resolved** - never a second resolution, which would be a second
 * chance to disagree with the first.
 *
 * # The order of operations is the security property
 *
 * Authorise, then filter, then aggregate, then total, then sort, then page. Counting
 * first would read responses for forms the caller cannot count; totalling first would
 * report how many rows exist rather than how many matched; paging first would make the
 * total a property of the page. The plan names this order and it is the only order here.
 *
 * # Nothing in here is N+1
 *
 * Four control-pool reads and two environment-pool reads for the whole page, whatever its
 * length: the forms, each form's release state in this environment, each form's last
 * release anywhere, each form's published display name, and the two aggregates. The
 * aggregates run on the **selected environment's** pool, because that is where its
 * responses live and the control pool holds no privilege on them.
 *
 * # It writes nothing, and that includes no audit row
 *
 * F4 (Q91): an aggregate response count is **not** a SEC-15 read and writes no row.
 * Showing one still needs `response: read` for that exact form and environment, which is
 * asked per row below. SEC-15's `read` kind means somebody looked at answers, and a row
 * per list render would bury the rows that record that.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  environmentStatesByForm,
  lastReleaseAtByForm,
  listForms,
  listWorkspaces,
  publishedTitlesByForm,
  responseCountsByForm,
  type FormEnvironmentState,
  type ResponseCounts,
  type WorkspaceRow,
} from "@roonga/qcms-db";

import type { FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { ResolvedMembership } from "../membership/context.js";
import { decideAccess, type Resource } from "../membership/policy.js";
import type { operationsFormsRoute } from "./route.js";
import { OPERATIONS_LIMIT_DEFAULT, OPERATIONS_LIMIT_MAX } from "./schema.js";

const fail = {
  /**
   * An environment this deployment does not serve.
   *
   * **It names no other environment** (D3): the set a caller may see is
   * `GET /admin/environments`' answer, which is narrowed to their own grants, and a
   * refusal here that listed the served set would see round that narrowing.
   */
  unknownEnvironment: (name: string): ApiError =>
    new ApiError("UNKNOWN_ENVIRONMENT", 400, `This deployment serves no environment named ${name}`),
  badCursor: (): ApiError =>
    new ApiError(
      "INVALID_CURSOR",
      400,
      "That cursor is not one this route issued. Request the first page and follow " +
        "`nextCursor`.",
    ),
  cursorSort: (): ApiError =>
    new ApiError(
      "CURSOR_SORT_MISMATCH",
      400,
      "That cursor was issued for a different order, and a position in one order is not a " +
        "position in another. Changing the sort starts at the first page.",
    ),
  badLimit: (): ApiError =>
    new ApiError(
      "INVALID_QUERY",
      400,
      `limit must be a positive integer of at most ${OPERATIONS_LIMIT_MAX}`,
    ),
  /**
   * The context an `anyOf` row leaves behind is missing.
   *
   * Unreachable in the mounted order - the grant middleware runs before every admin slice
   * and refuses a caller holding no operational cell - so this throws rather than
   * degrading to an empty page, which would be an unauthorised answer that looked like an
   * authorised one.
   */
  noContext: (): Error => new Error("operations: no resolved membership on the request context"),
} as const;

/** The write acts a row reports as capabilities, in the order a rail would offer them. */
const CAPABILITY_CELLS: readonly { readonly resource: Resource; readonly action: string }[] = [
  { resource: "form", action: "close" },
  { resource: "release", action: "create" },
  { resource: "link", action: "mint" },
  { resource: "link", action: "revoke" },
  { resource: "webhook", action: "configure" },
  { resource: "response", action: "export" },
  { resource: "response", action: "erase" },
  { resource: "response", action: "dispose" },
];

/** One assembled row, before filtering, sorting and paging. */
interface Candidate {
  readonly formId: FormId;
  readonly slug: string;
  readonly defaultLocale: string;
  readonly displayName: string;
  readonly workspace: {
    readonly workspaceId: string;
    readonly slug: string;
    readonly name: string;
  };
  readonly state: FormEnvironmentState | undefined;
  readonly lastReleaseAt: Date | undefined;
  readonly mayReadForm: boolean;
  readonly mayCount: boolean;
  readonly capabilities: readonly string[];
  counts: ResponseCounts | undefined;
}

/** The position a cursor encodes: the order it was issued for, and the row it stopped at. */
interface Cursor {
  readonly sort: string;
  readonly slug: string;
  readonly formId: string;
  readonly released: string | null;
  readonly submitted: number | null;
}

export function makeOperationsFormsHandler(
  deps: Deps,
): RouteHandler<typeof operationsFormsRoute, ApiEnv> {
  return async (c) => {
    const query = c.req.valid("query");
    const grant = c.get("grantContext");
    const memberships = grant?.memberships;
    if (memberships === undefined) throw fail.noContext();

    // The environment the **grant middleware authorised this caller against**, which is
    // this same parameter (`environmentFrom: "query"`). Checked against the pools this
    // process holds rather than the environments table, so the answer cannot be "it
    // exists and nothing here can reach it".
    const environment = query.environment;
    if (!deps.databases.names.includes(environment)) {
      throw fail.unknownEnvironment(environment);
    }
    const sort = query.sort ?? "slug-asc";
    const limit = parseLimit(query.limit);
    const cursor = parseCursor(query.cursor, sort);

    const exec = deps.databases.control;
    const byWorkspace = new Map(
      memberships.map((membership) => [membership.workspaceId, membership]),
    );
    // Narrowed to the workspaces the middleware resolved, so a workspace nobody granted
    // this caller anything in is not read at all.
    const rows = await listForms(exec, { workspaceIds: [...byWorkspace.keys()] });
    const [states, lastReleases, titles, workspaces] = await Promise.all([
      environmentStatesByForm(exec, environment),
      lastReleaseAtByForm(exec),
      publishedTitlesByForm(
        exec,
        rows.map((row) => row.formId),
      ),
      listWorkspaces(exec),
    ]);
    const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

    // 1. Authorise per form. A form the caller holds no operational cell on is not a row
    //    at all, so the three filters below cannot reveal its existence by counting it.
    const candidates: Candidate[] = [];
    for (const row of rows) {
      const membership = byWorkspace.get(row.workspaceId);
      const workspace = workspaceById.get(row.workspaceId);
      if (membership === undefined || workspace === undefined) continue;
      const candidate = authorise({
        row,
        membership,
        workspace,
        environment,
        state: states.get(row.formId),
        lastReleaseAt: lastReleases.get(row.formId),
        title: titles.get(row.formId),
      });
      if (candidate !== undefined) candidates.push(candidate);
    }

    // The filter options, from the **unfiltered** authorised set: a filter affects the
    // results below it and never the controls above them.
    const options = [...new Set(candidates.map((candidate) => candidate.workspace.workspaceId))]
      .map((id) => workspaceById.get(id))
      .filter((workspace): workspace is WorkspaceRow => workspace !== undefined)
      .map((workspace) => ({
        workspaceId: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug));

    // 2. Filter, before any aggregate and before the total.
    const needle = query.q?.trim().toLowerCase();
    const filtered = candidates.filter((candidate) => {
      if (
        query.workspaceId !== undefined &&
        candidate.workspace.workspaceId !== query.workspaceId
      ) {
        return false;
      }
      if (query.intake !== undefined && intakeOf(candidate) !== query.intake) return false;
      if (needle === undefined || needle === "") return true;
      return (
        candidate.slug.toLowerCase().includes(needle) ||
        candidate.displayName.toLowerCase().includes(needle)
      );
    });

    // 3. Aggregate, for the filtered rows this caller may count and no others. The read
    //    is on the selected environment's pool.
    const countable = filtered.filter((candidate) => candidate.mayCount);
    if (countable.length > 0) {
      const counts = await responseCountsByForm(
        deps.databases.for(environment),
        environment,
        countable.map((candidate) => candidate.formId),
      );
      for (const candidate of countable) candidate.counts = counts.get(candidate.formId);
    }

    // 4. Total, then 5. sort, then 6. page.
    const total = filtered.length;
    const ordered = [...filtered].sort((left, right) => compare(left, right, sort));
    const after =
      cursor === undefined
        ? ordered
        : ordered.filter((candidate) => compareWithCursor(candidate, cursor, sort) > 0);
    const page = after.slice(0, limit);
    const last = page[page.length - 1];

    return c.json(
      {
        environment,
        forms: page.map((candidate) => ({
          formId: candidate.formId,
          slug: candidate.slug,
          defaultLocale: candidate.defaultLocale,
          displayName: candidate.displayName,
          workspace: candidate.workspace,
          hasRelease: candidate.state !== undefined,
          release:
            candidate.mayReadForm && candidate.state !== undefined
              ? {
                  version: candidate.state.version,
                  releasedAt: candidate.state.releasedAt.toISOString(),
                  closed: candidate.state.closed,
                }
              : null,
          lastReleaseAt:
            candidate.mayReadForm && candidate.lastReleaseAt !== undefined
              ? candidate.lastReleaseAt.toISOString()
              : null,
          counts:
            candidate.mayCount && candidate.counts !== undefined
              ? { submitted: candidate.counts.submitted, inProgress: candidate.counts.inProgress }
              : null,
          capabilities: [...candidate.capabilities],
        })),
        total,
        nextCursor:
          after.length > page.length && last !== undefined ? encodeCursor(last, sort) : null,
        workspaces: options,
      },
      200,
    );
  };
}

/**
 * One form's row for one caller, or `undefined` when they hold no operational cell on it.
 *
 * Every field is gated by the cell that would authorise reading it elsewhere, which is
 * what keeps the projection honest without a role name appearing anywhere: a
 * `responses.viewer` is not "a role that sees no versions", it is a caller for whom
 * `form: read` decides false.
 */
function authorise(input: {
  readonly row: { formId: FormId; slug: string; defaultLocale: string; workspaceId: string };
  readonly membership: ResolvedMembership;
  readonly workspace: WorkspaceRow;
  readonly environment: string;
  readonly state: FormEnvironmentState | undefined;
  readonly lastReleaseAt: Date | undefined;
  readonly title: unknown;
}): Candidate | undefined {
  const { row, membership, environment } = input;
  const allows = (resource: Resource, action: string): boolean =>
    decideAccess({
      memberRole: membership.memberRole,
      grants: membership.grants,
      request: { resource, action, environment, formId: row.formId },
    }).allowed;

  const mayReadForm = allows("form", "read");
  const mayCount = allows("response", "read");
  const mayErase = allows("response", "erase") || allows("response", "dispose");
  if (!mayReadForm && !mayCount && !mayErase) return undefined;

  return {
    formId: row.formId,
    slug: row.slug,
    defaultLocale: row.defaultLocale,
    displayName: displayNameOf(input.title, row.defaultLocale) ?? row.slug,
    workspace: {
      workspaceId: input.workspace.id,
      slug: input.workspace.slug,
      name: input.workspace.name,
    },
    state: input.state,
    lastReleaseAt: input.lastReleaseAt,
    mayReadForm,
    mayCount,
    capabilities: CAPABILITY_CELLS.filter((cell) => allows(cell.resource, cell.action)).map(
      (cell) => `${cell.resource}:${cell.action}`,
    ),
    counts: undefined,
  };
}

/**
 * The form's name for a human, from a published version's localised title.
 *
 * The form's own default locale first, then any locale that carries a string, because a
 * title written in one language is still a better name than an identifier. `undefined`
 * when there is no title at all, and the caller falls back to the slug.
 */
function displayNameOf(title: unknown, defaultLocale: string): string | undefined {
  if (title === null || typeof title !== "object") {
    return typeof title === "string" && title !== "" ? title : undefined;
  }
  const values = title as Record<string, unknown>;
  const preferred = values[defaultLocale];
  if (typeof preferred === "string" && preferred !== "") return preferred;
  for (const value of Object.values(values)) {
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** A form's intake reading in the selected environment: unreleased is not closed (D3). */
function intakeOf(candidate: Candidate): "open" | "closed" | "unreleased" {
  if (candidate.state === undefined) return "unreleased";
  return candidate.state.closed ? "closed" : "open";
}

/**
 * The total order the table is served in.
 *
 * **Every branch falls through to `(slug, formId)`**, so two renders of the same page
 * never disagree and a cursor identifies one position rather than a set. A row the caller
 * may not count has no count to sort on and goes **last** in both count directions, which
 * is the same answer the form library gives an unpublished form on a publish-date axis:
 * inventing a zero would answer a question nobody asked, and it would also be a count
 * this caller is not entitled to.
 */
function compare(left: Candidate, right: Candidate, sort: string): number {
  const tie = (): number =>
    left.slug === right.slug
      ? left.formId.localeCompare(right.formId)
      : left.slug.localeCompare(right.slug);
  const descending = sort.endsWith("-desc");
  if (sort.startsWith("released")) {
    return byKey(releasedKey(left), releasedKey(right), descending, tie);
  }
  if (sort.startsWith("submitted")) {
    return byKey(submittedKey(left), submittedKey(right), descending, tie);
  }
  return descending ? -tie() : tie();
}

/**
 * Order two rows on one axis, with a null key always last and the tie-break underneath.
 *
 * `null` sorts last in **both** directions on purpose: it means "this caller has no such
 * key", which is not a position on the axis at all, so flipping the direction must not
 * promote it to the top of the page.
 */
function byKey(
  left: string | number | null,
  right: string | number | null,
  descending: boolean,
  tie: () => number,
): number {
  if (left === right) return tie();
  if (left === null) return 1;
  if (right === null) return -1;
  const ascending = left < right ? -1 : 1;
  return descending ? -ascending : ascending;
}

/** The release axis, and `null` for a caller who may not read it or a form never released. */
function releasedKey(candidate: Candidate): string | null {
  if (!candidate.mayReadForm || candidate.lastReleaseAt === undefined) return null;
  return candidate.lastReleaseAt.toISOString();
}

/** The count axis, and `null` for a caller who may not count this form (Q91). */
function submittedKey(candidate: Candidate): number | null {
  return candidate.mayCount && candidate.counts !== undefined ? candidate.counts.submitted : null;
}

/** Compare a row against a cursor's recorded position, in the cursor's own order. */
function compareWithCursor(candidate: Candidate, cursor: Cursor, sort: string): number {
  const stub: Candidate = {
    ...candidate,
    slug: cursor.slug,
    formId: cursor.formId as FormId,
    mayReadForm: cursor.released !== null,
    lastReleaseAt: cursor.released === null ? undefined : new Date(cursor.released),
    mayCount: cursor.submitted !== null,
    counts: cursor.submitted === null ? undefined : { submitted: cursor.submitted, inProgress: 0 },
  };
  return compare(candidate, stub, sort);
}

/**
 * The cursor: the order it belongs to and the sort keys of the row it stopped at.
 *
 * Opaque to a client and deliberately **not** an offset. An offset moves when a form is
 * released or a response arrives, so the row after it is not the row the caller has not
 * seen yet; a recorded position in a total order is stable under both.
 */
function encodeCursor(candidate: Candidate, sort: string): string {
  const position: Cursor = {
    sort,
    slug: candidate.slug,
    formId: candidate.formId,
    released: releasedKey(candidate),
    submitted: submittedKey(candidate),
  };
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

function parseCursor(raw: string | undefined, sort: string): Cursor | undefined {
  if (raw === undefined || raw === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw fail.badCursor();
  }
  const position = parsed as Partial<Cursor> | null;
  if (
    position === null ||
    typeof position !== "object" ||
    typeof position.sort !== "string" ||
    typeof position.slug !== "string" ||
    typeof position.formId !== "string"
  ) {
    throw fail.badCursor();
  }
  if (position.sort !== sort) throw fail.cursorSort();
  return {
    sort: position.sort,
    slug: position.slug,
    formId: position.formId,
    released: typeof position.released === "string" ? position.released : null,
    submitted: typeof position.submitted === "number" ? position.submitted : null,
  };
}

/** The page size: bounded, so an unbounded page is a refusal rather than unbounded work. */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return OPERATIONS_LIMIT_DEFAULT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > OPERATIONS_LIMIT_MAX) throw fail.badLimit();
  return value;
}
