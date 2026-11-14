import { z } from "@hono/zod-openapi";

import { WORKSPACE_SLUG_MAX_LENGTH, WORKSPACE_SLUG_PATTERN } from "./rules.js";

export const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "org_default_workspace" }),
});

const WorkspaceSlug = z
  .string()
  .min(1)
  .max(WORKSPACE_SLUG_MAX_LENGTH)
  .regex(WORKSPACE_SLUG_PATTERN)
  .openapi({ example: "home-insurance" });

export const CreateWorkspaceBody = z
  .strictObject({
    name: z.string().min(1).max(120).openapi({ example: "Home insurance" }),
    slug: WorkspaceSlug,
    /** The first Workspace administrator's address; the caller when absent. */
    firstAdministratorEmail: z.email().optional().openapi({ example: "ada@example.test" }),
  })
  .openapi("CreateWorkspaceBody");

/** No slug field: a rename never moves the workspace's address. */
export const RenameWorkspaceBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120).openapi({ example: "Home insurance" }),
  })
  .openapi("RenameWorkspaceBody");

export const SharedWorkspaceBody = z
  .strictObject({
    shared: z.boolean().openapi({ example: true }),
  })
  .openapi("SharedWorkspaceBody");

export const MoveToWorkspaceBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ example: "org_default_workspace" }),
  })
  .openapi("MoveToWorkspaceBody");

export const WorkspaceView = z
  .object({
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
    name: z.string().openapi({ example: "Default workspace" }),
    slug: WorkspaceSlug,
    archivedAt: z.iso.datetime().nullable(),
    /**
     * Administration, so present only for a caller holding `workspace: read` there. At
     * most one workspace is the installation's shared question library, and the counts say
     * why an archive would be refused.
     */
    isShared: z.boolean().optional(),
    requireSecondApprover: z.boolean().optional(),
    forms: z.number().int().nonnegative().optional().openapi({ example: 2 }),
    questions: z.number().int().nonnegative().optional().openapi({ example: 17 }),
  })
  .openapi("WorkspaceView");

export const WorkspaceListResponse = z
  .object({ workspaces: z.array(WorkspaceView) })
  .openapi("WorkspaceListResponse");

export const WorkspaceResponse = z
  .object({ workspace: WorkspaceView })
  .openapi("WorkspaceResponse");

export const MovedResponse = z
  .object({
    id: z.string().openapi({ example: "frm_signup" }),
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
  })
  .openapi("MovedResponse");
