import type { RouteHandler } from "@hono/zod-openapi";
import {
  LOGO_MAX_BYTES,
  deleteWorkspaceTheme,
  getAppearanceLogo,
  getWorkspaceTheme,
  insertAppearanceLogo,
  insertWorkspaceTheme,
  listWorkspaceThemes,
  setWorkspaceAppearanceLock,
  updateWorkspaceTheme,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { WorkspaceThemeInput, WorkspaceThemeRow } from "@roonga/qcms-db";

import {
  APPEARANCE_CORNERS,
  AppearanceFace,
  AppearancePalettes,
  LogoKey,
  checkPalettes,
  sniffRasterLogo,
} from "@roonga/qcms-core";
import type { AppearanceCorners, RasterLogoContentType } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { requireOpenWorkspace, requireWorkspace, workspaceFail } from "./resolve.js";
import type {
  createWorkspaceThemeRoute,
  deleteWorkspaceThemeRoute,
  getWorkspaceThemeRoute,
  listWorkspaceThemesRoute,
  setAppearanceLockRoute,
  updateWorkspaceThemeRoute,
  uploadThemeLogoRoute,
} from "./route.js";

const fail = {
  noPrincipal: (): ApiError =>
    new ApiError("ADMIN_REQUIRED", 401, "This act is attributed to an account, so it needs a session"),
  themeNotFound: (): ApiError => new ApiError("THEME_NOT_FOUND", 404, "No such theme"),
  nameTaken: (name: string): ApiError =>
    new ApiError("THEME_NAME_TAKEN", 409, `This workspace already has a theme named "${name}"`),
  invalidTheme: (detail: string): ApiError => new ApiError("INVALID_THEME", 422, detail),
  /** The correction report, so a caller is told which pair fell short rather than that one did. */
  contrast: (failures: readonly unknown[]): ApiError =>
    new ApiError(
      "APPEARANCE_CONTRAST",
      422,
      "Some colour pairs do not meet their minimum contrast ratio",
      { failures },
    ),
  unknownLogo: (): ApiError =>
    new ApiError("LOGO_NOT_FOUND", 422, "No stored logo has that key; upload the image first"),
  malformedLogo: (): ApiError => new ApiError("INVALID_LOGO", 400, "The body is not valid base64"),
  logoTooLarge: (): ApiError =>
    new ApiError(
      "LOGO_TOO_LARGE",
      413,
      `A logo may be at most ${String(LOGO_MAX_BYTES)} bytes`,
    ),
  /**
   * One answer for an SVG, a polyglot and anything else the bytes do not declare as one of
   * the three raster types: the sniff is the only authority, so there is nothing more to say.
   */
  notRaster: (): ApiError =>
    new ApiError(
      "LOGO_NOT_RASTER",
      422,
      "A logo must be a PNG, JPEG or WebP image. The bytes decide, not the request's content type, and SVG is refused.",
    ),
} as const;

function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

function view(row: WorkspaceThemeRow): {
  themeId: string;
  workspaceId: string;
  name: string;
  palettes: unknown;
  face: string;
  corners: string;
  pageTint: boolean;
  logoKey: string | null;
  sourceHost: string | null;
  updatedAt: string;
} {
  return {
    themeId: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    palettes: row.palettes,
    face: row.face,
    corners: row.corners,
    pageTint: row.pageTint,
    logoKey: row.logoKey,
    sourceHost: row.sourceHost,
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface ThemeBody {
  readonly name: string;
  readonly palettes: Record<string, unknown>;
  readonly face: string;
  readonly corners: string;
  readonly pageTint: boolean;
  readonly logoKey?: string | null | undefined;
  readonly sourceHost?: string | null | undefined;
}

/**
 * The palettes go through the shared schema and the contrast check, so a theme that could
 * never be applied to a draft is refused where it is written rather than where it is used.
 * A named logo must already be in the immutable store.
 */
async function checkedTheme(deps: Deps, body: ThemeBody): Promise<WorkspaceThemeInput> {
  const palettes = AppearancePalettes.safeParse(body.palettes);
  if (!palettes.success) throw fail.invalidTheme(`palettes: ${palettes.error.message}`);
  const failures = checkPalettes(palettes.data);
  if (failures.length > 0) throw fail.contrast(failures);

  const face = AppearanceFace.safeParse(body.face);
  if (!face.success) throw fail.invalidTheme("face: not a registry face");
  if (!APPEARANCE_CORNERS.includes(body.corners as AppearanceCorners)) {
    throw fail.invalidTheme("corners: not one of sharp, subtle, rounded, pill");
  }

  const logoKey = body.logoKey ?? null;
  if (logoKey !== null) {
    if (!LogoKey.safeParse(logoKey).success) throw fail.invalidTheme("logoKey: not a logo key");
    if ((await getAppearanceLogo(deps.databases.control, logoKey)) === undefined) {
      throw fail.unknownLogo();
    }
  }

  return {
    name: body.name,
    palettes: palettes.data,
    face: face.data,
    corners: body.corners as AppearanceCorners,
    pageTint: body.pageTint,
    logoKey,
    sourceHost: body.sourceHost ?? null,
  };
}

export function makeListWorkspaceThemesHandler(
  deps: Deps,
): RouteHandler<typeof listWorkspaceThemesRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    await requireWorkspace(deps.databases.control, workspaceId);
    const rows = await listWorkspaceThemes(deps.databases.control, workspaceId);
    return c.json({ themes: rows.map(view) }, 200);
  };
}

export function makeGetWorkspaceThemeHandler(
  deps: Deps,
): RouteHandler<typeof getWorkspaceThemeRoute, ApiEnv> {
  return async (c) => {
    const { id, themeId } = c.req.valid("param");
    await requireWorkspace(deps.databases.control, id);
    const row = await getWorkspaceTheme(deps.databases.control, id, themeId);
    if (row === undefined) throw fail.themeNotFound();
    return c.json({ theme: view(row) }, 200);
  };
}

export function makeCreateWorkspaceThemeHandler(
  deps: Deps,
): RouteHandler<typeof createWorkspaceThemeRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    await requireOpenWorkspace(deps.databases.control, workspaceId);
    const input = await checkedTheme(deps, c.req.valid("json"));

    try {
      const row = await insertWorkspaceTheme(deps.databases.control, {
        ...input,
        workspaceId,
        actor: principal.userId,
      });
      return c.json({ theme: view(row) }, 201);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) throw fail.nameTaken(input.name);
      throw err;
    }
  };
}

export function makeUpdateWorkspaceThemeHandler(
  deps: Deps,
): RouteHandler<typeof updateWorkspaceThemeRoute, ApiEnv> {
  return async (c) => {
    const { id, themeId } = c.req.valid("param");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    await requireOpenWorkspace(deps.databases.control, id);
    const input = await checkedTheme(deps, c.req.valid("json"));

    try {
      const row = await updateWorkspaceTheme(deps.databases.control, {
        ...input,
        workspaceId: id,
        themeId,
        actor: principal.userId,
        now: deps.clock.now(),
      });
      if (row === undefined) throw fail.themeNotFound();
      return c.json({ theme: view(row) }, 200);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) throw fail.nameTaken(input.name);
      throw err;
    }
  };
}

/**
 * Removes the theme row and no logo: the bytes are immutable and undeletable, so every
 * draft and version that copied this theme keeps the image it carries (criterion 124).
 */
export function makeDeleteWorkspaceThemeHandler(
  deps: Deps,
): RouteHandler<typeof deleteWorkspaceThemeRoute, ApiEnv> {
  return async (c) => {
    const { id, themeId } = c.req.valid("param");
    await requireWorkspace(deps.databases.control, id);
    if (!(await deleteWorkspaceTheme(deps.databases.control, id, themeId))) {
      throw fail.themeNotFound();
    }
    return c.body(null, 204);
  };
}

function decodeBase64(value: string): Buffer {
  // Round-tripped, because `Buffer.from` drops anything it cannot read rather than failing.
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value.replaceAll(/\s/gu, "")) throw fail.malformedLogo();
  return bytes;
}

async function sha256Hex(bytes: Buffer): Promise<string> {
  // Copied into a plain view: a `Buffer` is backed by a pooled `ArrayBufferLike`, which
  // `crypto.subtle.digest` does not take.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Content-addressed, so the same image uploaded twice resolves to one row and one key.
 * The stored content type is the sniffed one and never the request's, which is what keeps
 * the serving route's fixed type honest.
 */
export function makeUploadThemeLogoHandler(
  deps: Deps,
): RouteHandler<typeof uploadThemeLogoRoute, ApiEnv> {
  return async (c) => {
    const { id, themeId } = c.req.valid("param");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    await requireOpenWorkspace(deps.databases.control, id);
    const theme = await getWorkspaceTheme(deps.databases.control, id, themeId);
    if (theme === undefined) throw fail.themeNotFound();

    const bytes = decodeBase64(c.req.valid("json").bytesBase64);
    if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) throw fail.logoTooLarge();
    const contentType: RasterLogoContentType | null = sniffRasterLogo(bytes);
    if (contentType === null) throw fail.notRaster();

    const key = await sha256Hex(bytes);
    await deps.databases.control.transaction(async (tx) => {
      await insertAppearanceLogo(tx, { key, contentType, bytes, actor: principal.userId });
      await updateWorkspaceTheme(tx, {
        name: theme.name,
        palettes: theme.palettes,
        face: theme.face,
        corners: theme.corners,
        pageTint: theme.pageTint,
        sourceHost: theme.sourceHost,
        logoKey: key,
        workspaceId: id,
        themeId,
        actor: principal.userId,
        now: deps.clock.now(),
      });
    });

    return c.json({ logoKey: key, contentType, bytes: bytes.byteLength }, 201);
  };
}

/**
 * A workspace setting: no second approval, even with the rule on, and exactly one
 * `setting` row, written only where the value changed (criterion 120).
 */
export function makeSetAppearanceLockHandler(
  deps: Deps,
): RouteHandler<typeof setAppearanceLockRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const { locked } = c.req.valid("json");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    await requireOpenWorkspace(deps.databases.control, workspaceId);

    const workspace = await deps.databases.control.transaction(async (tx) => {
      const result = await setWorkspaceAppearanceLock(tx, workspaceId, locked);
      // The update matches an unarchived row alone, so this is an archive that landed
      // after the pre-read.
      if (result === undefined) throw workspaceFail.archived();
      if (result.previouslyLocked !== locked) {
        await writeAccessAuditRow(tx, {
          actor: principal.userId,
          workspaceId,
          kind: "setting",
          detail: `setting=appearanceLock to=${String(locked)}`,
          occurredAt: deps.clock.now(),
        });
      }
      return result.workspace;
    });

    return c.json(
      { workspaceId: workspace.id, appearanceLocked: workspace.appearanceLocked },
      200,
    );
  };
}
