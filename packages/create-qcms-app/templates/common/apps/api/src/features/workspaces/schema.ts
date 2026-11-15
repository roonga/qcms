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

export const ThemeIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "org_default_workspace" }),
  themeId: z.string().openapi({
    param: { name: "themeId", in: "path" },
    example: "9f3a2b1c-0000-4000-8000-000000000000",
  }),
});

/**
 * Opaque like a form definition, so the handler answers with the appearance schema's coded
 * 422 and the contrast check's correction report rather than a bare 400.
 */
const OpaquePalettes = z.record(z.string(), z.unknown()).openapi("ThemePalettesInput", {
  description:
    "The four palettes (light, dark, lightHighContrast, darkHighContrast), each a complete set of colour tokens. Validated against the shared appearance schema and the WCAG contrast check.",
});

export const WorkspaceThemeBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120).openapi({ example: "Harbour" }),
    palettes: OpaquePalettes,
    face: z.string().min(1).max(64).openapi({ example: "system" }),
    corners: z.string().min(1).max(16).openapi({ example: "subtle" }),
    pageTint: z.boolean().openapi({ example: false }),
    /** A key already in the immutable logo store, uploaded through the logo route. */
    logoKey: z.string().nullable().optional().openapi({ example: null }),
    /** The host a derive read, for a theme made by hand absent or null. */
    sourceHost: z.string().max(253).nullable().optional().openapi({ example: null }),
  })
  .openapi("WorkspaceThemeBody");

/** Base64 because a theme save and a logo upload travel the same JSON channel. */
export const ThemeLogoBody = z
  .strictObject({
    bytesBase64: z.string().min(1).openapi({
      description:
        "The image, base64-encoded. PNG, JPEG or WebP only, confirmed by magic-number sniff; SVG is refused. Capped at 512 KiB decoded.",
    }),
  })
  .openapi("ThemeLogoBody");

export const AppearanceLockBody = z
  .strictObject({
    locked: z.boolean().openapi({ example: true }),
  })
  .openapi("AppearanceLockBody");

export const WorkspaceThemeView = z
  .object({
    themeId: z.string(),
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
    name: z.string().openapi({ example: "Harbour" }),
    palettes: z.unknown(),
    face: z.string().openapi({ example: "system" }),
    corners: z.string().openapi({ example: "subtle" }),
    pageTint: z.boolean().openapi({ example: false }),
    logoKey: z.string().nullable(),
    sourceHost: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("WorkspaceThemeView");

export const WorkspaceThemeListResponse = z
  .object({ themes: z.array(WorkspaceThemeView) })
  .openapi("WorkspaceThemeListResponse");

export const WorkspaceThemeResponse = z
  .object({ theme: WorkspaceThemeView })
  .openapi("WorkspaceThemeResponse");

/** The key is the lowercase hex SHA-256 of the stored bytes, so it is the address too. */
export const ThemeLogoResponse = z
  .object({
    logoKey: z.string().openapi({ example: "a".repeat(64) }),
    contentType: z.string().openapi({ example: "image/png" }),
    bytes: z.number().int().positive().openapi({ example: 2048 }),
  })
  .openapi("ThemeLogoResponse");

export const AppearanceLockResponse = z
  .object({
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
    appearanceLocked: z.boolean().openapi({ example: true }),
  })
  .openapi("AppearanceLockResponse");

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
