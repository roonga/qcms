/**
 * `GET /admin/operations/forms` - the forms a caller operates in one environment (R2).
 *
 * The environment is a query parameter rather than the switcher header, because that is
 * what the route's grant row authorises against: the Operations context is explicit.
 */

import { cache } from "react";

import type {
  OperationsCounts,
  OperationsFormRow,
  OperationsFormsPage,
  OperationsRelease,
  OperationsWorkspace,
} from "../ops/operations-forms.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The query string is one argument so `cache()` can memoize it: the page and its `@rail`
 * slot are two trees of one request and ask the same question.
 */
export const listOperationsForms: (
  session: AdminSession,
  query: string,
) => Promise<ApiResult<OperationsFormsPage>> = cache(
  async (session: AdminSession, query: string): Promise<ApiResult<OperationsFormsPage>> => {
    const environment = new URLSearchParams(query).get("environment") ?? undefined;
    const result = await readResult<Record<string, unknown>>(
      await adminApiFetch(session, `/operations/forms?${query}`, {
        ...(environment === undefined ? {} : { environment }),
      }),
    );
    if (!result.ok) return result;
    return { ok: true, data: parsePage(result.data) };
  },
);

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function workspace(value: unknown): OperationsWorkspace {
  const row = record(value);
  return {
    workspaceId: str(row?.["workspaceId"]),
    slug: str(row?.["slug"]),
    name: str(row?.["name"]),
  };
}

function release(value: unknown): OperationsRelease | null {
  const row = record(value);
  if (row === undefined) return null;
  return {
    version: num(row["version"]),
    releasedAt: str(row["releasedAt"]),
    closed: row["closed"] === true,
  };
}

function counts(value: unknown): OperationsCounts | null {
  const row = record(value);
  if (row === undefined) return null;
  return { submitted: num(row["submitted"]), inProgress: num(row["inProgress"]) };
}

function parsePage(body: Record<string, unknown>): OperationsFormsPage {
  const rows = Array.isArray(body["forms"]) ? body["forms"] : [];
  const options = Array.isArray(body["workspaces"]) ? body["workspaces"] : [];
  return {
    environment: str(body["environment"]),
    forms: rows.flatMap((entry): OperationsFormRow[] => {
      const row = record(entry);
      if (row === undefined) return [];
      return [
        {
          formId: str(row["formId"]),
          slug: str(row["slug"]),
          defaultLocale: str(row["defaultLocale"]),
          displayName: str(row["displayName"]),
          workspace: workspace(row["workspace"]),
          hasRelease: row["hasRelease"] === true,
          release: release(row["release"]),
          lastReleaseAt: typeof row["lastReleaseAt"] === "string" ? row["lastReleaseAt"] : null,
          counts: counts(row["counts"]),
          capabilities: Array.isArray(row["capabilities"])
            ? row["capabilities"].filter((entry): entry is string => typeof entry === "string")
            : [],
        },
      ];
    }),
    total: num(body["total"]),
    nextCursor: typeof body["nextCursor"] === "string" ? body["nextCursor"] : null,
    workspaces: options.map((entry) => workspace(entry)),
  };
}
