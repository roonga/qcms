import { FormId } from "@roonga/qcms-core";

import { openDbHandle } from "../../../api/e2e/support/admin-accounts.js";
import {
  archiveWorkspaceFixture,
  seedFormIdentity,
  seedWorkspace,
  seedWorkspaceAccess,
  setSecondApproval,
  workspaceOfForm,
  type SeededWorkspace,
} from "../../../api/e2e/support/workspace-fixtures.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { accountIdOf } from "./admin-account.js";

type Handle = ReturnType<typeof openDbHandle>;

async function withDb<T>(run: (handle: Handle) => Promise<T>): Promise<T> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    return await run(handle);
  } finally {
    await handle.close();
  }
}

export type { SeededWorkspace };

/** A workspace of this run's own, administered by `firstAdministrator`. */
export async function createWorkspace(
  name: string,
  slug: string,
  firstAdministrator: string,
): Promise<SeededWorkspace> {
  const firstAdministratorId = await accountIdOf(firstAdministrator);
  return withDb((handle) => seedWorkspace(handle.db, { name, slug, firstAdministratorId }));
}

/** Put one account in one workspace with the groups it needs there. */
export async function grantInWorkspace(
  email: string,
  workspaceId: string,
  options: { readonly grants?: readonly string[]; readonly owner?: boolean } = {},
): Promise<void> {
  const userId = await accountIdOf(email);
  await withDb((handle) =>
    seedWorkspaceAccess(handle.db, {
      userId,
      workspaceId,
      grants: options.grants ?? [],
      owner: options.owner ?? false,
    }),
  );
}

/** A form identity in one workspace, as a form created and never drafted in. */
export async function createFormIn(workspaceId: string, slug: string): Promise<string> {
  const formId = FormId.parse(`frm_${slug.replaceAll("-", "_")}`);
  await withDb((handle) => seedFormIdentity(handle.db, { formId, slug, workspaceId }));
  return formId;
}

export async function workspaceOf(formId: string): Promise<string | undefined> {
  return withDb((handle) => workspaceOfForm(handle.db, FormId.parse(formId)));
}

export async function setWorkspaceSecondApproval(workspaceId: string, on: boolean): Promise<void> {
  await withDb((handle) => setSecondApproval(handle.db, workspaceId, on));
}

export async function archiveWorkspaceDirectly(workspaceId: string): Promise<void> {
  await withDb((handle) => archiveWorkspaceFixture(handle.db, workspaceId, new Date()));
}

/** The newest session token the account holds, for a spec that calls an API route as them. */
export async function sessionTokenOf(email: string): Promise<string> {
  const userId = await accountIdOf(email);
  const found = await withDb(async (handle) =>
    handle.query<{ token: string }>(
      `select token from "session" where "userId" = $1 order by "createdAt" desc limit 1`,
      [userId],
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw new Error(`no session for ${email}`);
  return row.token;
}

export interface StoredRequest {
  readonly requestId: string;
  readonly status: string;
}

/** This workspace's approval requests of one kind, newest first. */
export async function workspaceRequests(
  workspaceId: string,
  kind: string,
): Promise<readonly StoredRequest[]> {
  const found = await withDb(async (handle) =>
    handle.query<StoredRequest>(
      `select request_id as "requestId", status from control."approval_requests"
        where workspace_id = $1 and kind = $2
        order by requested_at desc`,
      [workspaceId, kind],
    ),
  );
  return found.rows;
}

/** The access-audit details of one kind in one workspace, newest first. */
export async function auditDetails(workspaceId: string, kind: string): Promise<readonly string[]> {
  const found = await withDb(async (handle) =>
    handle.query<{ detail: string | null }>(
      `select detail from control."access_audit"
        where workspace_id = $1 and kind = $2
        order by occurred_at desc`,
      [workspaceId, kind],
    ),
  );
  return found.rows.map((row) => row.detail ?? "");
}

/** How many forms a workspace still owns, which is what archiving is refused over. */
export async function formCountIn(workspaceId: string): Promise<number> {
  const found = await withDb(async (handle) =>
    handle.query<{ total: string }>(
      `select count(*) as total from control."forms" where workspace_id = $1`,
      [workspaceId],
    ),
  );
  return Number(found.rows[0]?.total ?? "0");
}
