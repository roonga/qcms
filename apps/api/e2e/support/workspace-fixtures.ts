/**
 * Workspaces, grants and form identities for a suite that needs more than the one seeded
 * workspace. Written through `@roonga/qcms-db`'s own helpers, as `seedGrants` is, so a
 * fixture and the product's write path agree about the shape of what they write.
 */

import type { FormId } from "@roonga/qcms-core";
import {
  archiveWorkspace,
  createForm,
  getForm,
  insertWorkspace,
  setRequireSecondApprover,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import { seedGrants } from "../../src/test-support.js";

export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly name: string;
}

/** A workspace with `firstAdministratorId` as its first Workspace administrator. */
export async function seedWorkspace(
  exec: Executor,
  input: {
    readonly name: string;
    readonly slug: string;
    readonly firstAdministratorId: string;
  },
): Promise<SeededWorkspace> {
  const row = await insertWorkspace(exec, input);
  return { workspaceId: row.id, name: row.name };
}

/** One account's groups in one workspace, and whether it administers it. */
export async function seedWorkspaceAccess(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly grants: readonly string[];
    readonly owner: boolean;
  },
): Promise<void> {
  await seedGrants(exec, input);
}

/** A form identity in one workspace. It carries no version, as a just-created form does. */
export async function seedFormIdentity(
  exec: Executor,
  input: { readonly formId: FormId; readonly slug: string; readonly workspaceId: string },
): Promise<void> {
  await createForm(exec, { ...input, defaultLocale: "en" });
}

/** The workspace a form is in, which is what a move has to be read back through. */
export async function workspaceOfForm(exec: Executor, formId: FormId): Promise<string | undefined> {
  return (await getForm(exec, formId))?.workspaceId;
}

export async function setSecondApproval(
  exec: Executor,
  workspaceId: string,
  on: boolean,
): Promise<void> {
  await setRequireSecondApprover(exec, workspaceId, on);
}

export async function archiveWorkspaceFixture(
  exec: Executor,
  workspaceId: string,
  at: Date,
): Promise<void> {
  await archiveWorkspace(exec, workspaceId, at);
}
