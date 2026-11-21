import { z } from "@hono/zod-openapi";

import { APPEARANCE_COLOR_TOKENS, APPEARANCE_FACES, PALETTE_KINDS } from "@roonga/qcms-core";
import type { AppearanceColorToken } from "@roonga/qcms-core";

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
    handOn: z
      .boolean()
      .optional()
      .openapi({
        description:
          "With `shared: true`, unmark whichever workspace holds the library in the same act " +
          "rather than refusing",
        example: true,
      }),
  })
  .openapi("SharedWorkspaceBody");

/** The themes table's primary key is `uuid`, so anything else is not a theme id at all. */
export const ThemeId = z.uuid();

export const ThemeIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "org_default_workspace" }),
  /**
   * Left opaque so a malformed id answers the one 404 an unknown id answers rather than a
   * shape error a caller could tell apart.
   */
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
        "The image, base64-encoded. A non-interlaced PNG or a JPEG only, confirmed by magic-number sniff; WebP and SVG are refused. Capped at 512 KiB decoded.",
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
  .object({
    themes: z.array(WorkspaceThemeView),
    /** Carried here so an Edit forms holder, who may not read workspace settings, still sees it. */
    appearanceLocked: z.boolean().openapi({ example: false }),
  })
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

export const MovePreviewQuery = z.object({
  workspaceId: z
    .string()
    .min(1)
    .openapi({ param: { name: "workspaceId", in: "query" }, example: "org_default_workspace" }),
});

const MovedAct = z
  .object({
    act: z.string().openapi({ example: "response.read" }),
    environments: z.array(z.string()).openapi({ example: ["prod"] }),
  })
  .openapi("MovedAct");

const MovePreviewPerson = z
  .object({
    name: z.string().openapi({
      description: "The display name, or the email address where the name is blank",
      example: "Priya Shah",
    }),
    acts: z.array(MovedAct),
  })
  .openapi("MovePreviewPerson");

export const MovePreviewResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    sourceWorkspaceId: z.string().openapi({ example: "org_default_workspace" }),
    destinationWorkspaceId: z.string().openapi({ example: "org_finance" }),
    requiresApproval: z.boolean().openapi({ example: true }),
    holdReason: z.enum(["second-approval", "not-source-administrator"]).nullable(),
    gains: z.array(MovePreviewPerson),
    losses: z.array(MovePreviewPerson),
  })
  .openapi("MoveFormPreview");

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

/** The user types the address; the model never supplies one (SEC-18 W2). */
export const DeriveThemeBody = z
  .strictObject({
    url: z.string().min(1).max(2048).openapi({ example: "https://www.example.com/" }),
  })
  .openapi("DeriveThemeBody");

const DerivedHex = z.string().regex(/^#[0-9a-f]{6}$/iu);

const DerivedPalette = z.strictObject(
  Object.fromEntries(APPEARANCE_COLOR_TOKENS.map((token) => [token, DerivedHex])) as Record<
    AppearanceColorToken,
    typeof DerivedHex
  >,
);

const FACE_KEYS = APPEARANCE_FACES.map((face) => face.key) as [
  (typeof APPEARANCE_FACES)[number]["key"],
  ...(typeof APPEARANCE_FACES)[number]["key"][],
];

/**
 * Hex colours, registry enums and a logo key, and no free string anywhere: no page title,
 * alt text, font name or URL, so nothing the page wrote can reach a model (SEC-18 M1).
 */
export const DeriveResult = z
  .strictObject({
    palettes: z.strictObject({
      light: DerivedPalette,
      dark: DerivedPalette,
      lightHighContrast: DerivedPalette,
      darkHighContrast: DerivedPalette,
    }),
    face: z.enum(FACE_KEYS),
    pageTint: z.boolean(),
    /** A re-encoded logo already in the store, or null where the page offered none. */
    logoKey: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    corrections: z.array(
      z.strictObject({
        palette: z.enum(PALETTE_KINDS),
        token: z.enum(APPEARANCE_COLOR_TOKENS),
        from: DerivedHex,
        to: DerivedHex,
      }),
    ),
    tintDropped: z.array(z.enum(PALETTE_KINDS)),
  })
  .openapi("DeriveResult");
export type DeriveResult = z.infer<typeof DeriveResult>;

export const DeriveThemeResponse = z
  .object({ derived: DeriveResult })
  .openapi("DeriveThemeResponse");
