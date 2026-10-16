import { z } from "@hono/zod-openapi";

import { WORKSPACE_SLUG_MAX_LENGTH, WORKSPACE_SLUG_PATTERN } from "./rules.js";

/**
 * Request and response schemas for the workspace routes (ADR-41, task 068).
 *
 * Zod only, no logic. Two things are worth reading twice because they are absent:
 *
 *   - **No role, no membership and no grant anywhere in this file.** Task 068 builds the
 *     container; the six roles, the scope and the access-group names are 069's, and a
 *     body here that accepted a role would be inventing part of that task's contract.
 *   - **No `requireSecondApprover`.** The field exists on the row and defaults off
 *     (Q13), and task 070 is what reads it. Nothing in this task writes it, so no body
 *     carries it - a switch a client can set before anything acts on it is a switch that
 *     reads as working.
 */

/** `:id` on every `/workspaces/{id}/...` route in this slice. */
export const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "org_default_workspace" }),
});

/** A workspace slug: lowercase letters, digits and hyphens (ADR-41, never dotted). */
const WorkspaceSlug = z
  .string()
  .min(1)
  .max(WORKSPACE_SLUG_MAX_LENGTH)
  .regex(WORKSPACE_SLUG_PATTERN)
  .openapi({ example: "home-insurance" });

/**
 * `POST /admin/workspaces` - a display name and a slug, and nothing else.
 *
 * The creator becomes the workspace's `forms.owner` through better-auth's own
 * `createOrganization` (Q32), so the body names no owner: the account making the request
 * is the one attribution it could have, and taking it from the session rather than the
 * body is what stops a caller attributing a workspace to somebody else.
 */
export const CreateWorkspaceBody = z
  .strictObject({
    name: z.string().min(1).max(120).openapi({ example: "Home insurance" }),
    slug: WorkspaceSlug,
  })
  .openapi("CreateWorkspaceBody");

/** `PUT /admin/workspaces/{id}/shared` - mark this workspace as the library, or unmark it. */
export const SharedWorkspaceBody = z
  .strictObject({
    shared: z.boolean().openapi({ example: true }),
  })
  .openapi("SharedWorkspaceBody");

/** `POST /admin/forms/{id}/workspace` and `.../questions/{id}/workspace` - the new owner. */
export const MoveToWorkspaceBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ example: "org_default_workspace" }),
  })
  .openapi("MoveToWorkspaceBody");

/** One workspace as the admin surface reads it. */
export const WorkspaceView = z
  .object({
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
    name: z.string().openapi({ example: "Default workspace" }),
    slug: WorkspaceSlug,
    /** Whether this is the installation's shared question library (at most one is). */
    isShared: z.boolean(),
    /**
     * The two-person switch for `prod` (Q13, off by default).
     *
     * Reported because an owner has to be able to see what it is set to; **not writable
     * through any route in this task**, and nothing reads it until task 070.
     */
    requireSecondApprover: z.boolean(),
    /** When this workspace was archived, or null. A workspace is never deleted (Q15). */
    archivedAt: z.iso.datetime().nullable(),
    /** What it owns, so a list can say why an archive would be refused. */
    forms: z.number().int().nonnegative().openapi({ example: 2 }),
    questions: z.number().int().nonnegative().openapi({ example: 17 }),
  })
  .openapi("WorkspaceView");

export const WorkspaceListResponse = z
  .object({ workspaces: z.array(WorkspaceView) })
  .openapi("WorkspaceListResponse");

export const WorkspaceResponse = z
  .object({ workspace: WorkspaceView })
  .openapi("WorkspaceResponse");

/** The answer to a move: the object and the workspace that owns it now. */
export const MovedResponse = z
  .object({
    id: z.string().openapi({ example: "frm_signup" }),
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
  })
  .openapi("MovedResponse");
