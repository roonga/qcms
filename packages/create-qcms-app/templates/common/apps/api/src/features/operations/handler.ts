/**
 * Five grants reach this route and each sees a different projection of an overlapping
 * subset of forms, which no single SQL predicate expresses: so authorisation is
 * `decideAccess`, asked per form, cell and environment against the grants the middleware
 * already resolved. Authorise, then filter, then aggregate, then total, then sort, then
 * page. It writes nothing, an audit row included.
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
  // It names no other environment: the set a caller may see is `GET /admin/environments`'
  // answer, which is narrowed to their own grants.
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
  // Unreachable in the mounted order: the grant middleware refuses a caller holding no
  // operational cell. Throwing beats an empty page, which would look authorised.
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

/** A page position: the order it was issued for, and the sort keys of the last row. */
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
    const memberships = c.get("grantContext")?.memberships;
    if (memberships === undefined) throw fail.noContext();

    // The same parameter the grant middleware authorised this caller against, checked
    // against the pools this process holds rather than the environments table.
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
    const rows = await listForms(exec, { workspaceIds: [...byWorkspace.keys()] });
    const formIds = rows.map((row) => row.formId);
    const [states, lastReleases, titles, workspaces] = await Promise.all([
      environmentStatesByForm(exec, environment, formIds),
      lastReleaseAtByForm(exec, formIds),
      publishedTitlesByForm(exec, formIds),
      listWorkspaces(exec),
    ]);
    const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

    // Authorise per form first, so the filters below cannot reveal a form's existence by
    // counting it.
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

    // From the unfiltered authorised set: a filter affects the results below it, never
    // the controls above them.
    const options = [...new Set(candidates.map((candidate) => candidate.workspace.workspaceId))]
      .map((id) => workspaceById.get(id))
      .filter((workspace): workspace is WorkspaceRow => workspace !== undefined)
      .map((workspace) => ({
        workspaceId: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug));

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

    // Aggregate on the selected environment's pool, for the filtered rows this caller may
    // count and no others.
    const countable = filtered.filter((candidate) => candidate.mayCount);
    if (countable.length > 0) {
      const counts = await responseCountsByForm(
        deps.databases.for(environment),
        environment,
        countable.map((candidate) => candidate.formId),
      );
      for (const candidate of countable) candidate.counts = counts.get(candidate.formId);
    }

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
 * Every field is gated by the cell that would authorise reading it elsewhere, so no role
 * name appears anywhere.
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

// The form's own default locale first, then any locale carrying a string: a title in one
// language is still a better name than an identifier.
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

// Unreleased is a third answer, not a reading of closed.
function intakeOf(candidate: Candidate): "open" | "closed" | "unreleased" {
  if (candidate.state === undefined) return "unreleased";
  return candidate.state.closed ? "closed" : "open";
}

// Every branch falls through to `(slug, formId)`, so the order is total and a cursor
// identifies one position rather than a set.
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

// A null key sorts last in both directions: it means the caller has no such key, which is
// not a position on the axis, so flipping the order must not promote it.
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

function releasedKey(candidate: Candidate): string | null {
  if (!candidate.mayReadForm || candidate.lastReleaseAt === undefined) return null;
  return candidate.lastReleaseAt.toISOString();
}

function submittedKey(candidate: Candidate): number | null {
  return candidate.mayCount && candidate.counts !== undefined ? candidate.counts.submitted : null;
}

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

// A recorded position rather than an offset: an offset moves when a form is released or a
// response arrives, so the row after it is not the row the caller has yet to see.
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

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return OPERATIONS_LIMIT_DEFAULT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > OPERATIONS_LIMIT_MAX) throw fail.badLimit();
  return value;
}
