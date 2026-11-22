import {
  workspaceThemeKey,
  type ThemeOption,
  type ThemePalettes,
} from "../forms/appearance-edit.ts";
import { parseDraftAppearance } from "../forms/preview-appearance.ts";
import { adminApiFetch } from "./api.ts";
import { readNoContent, readResult, type ApiResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

export interface WorkspaceTheme {
  readonly themeId: string;
  readonly name: string;
  readonly palettes: ThemePalettes;
  readonly face: string;
  readonly corners: string;
  readonly pageTint: boolean;
  readonly logoKey: string | null;
  readonly sourceHost: string | null;
  readonly updatedAt: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A theme whose palettes the preview reader refuses is left out: a row that cannot be previewed
 * could not be applied either, and the Theme list offers no act the draft save would refuse.
 */
function parseTheme(raw: Record<string, unknown>): WorkspaceTheme | undefined {
  const appearance = parseDraftAppearance({
    palettes: raw["palettes"],
    face: raw["face"],
    corners: raw["corners"],
    density: "comfortable",
    progress: "none",
  });
  if (appearance === null) return undefined;
  return {
    themeId: str(raw["themeId"]),
    name: str(raw["name"]),
    palettes: appearance.palettes,
    face: appearance.face,
    corners: appearance.corners,
    pageTint: raw["pageTint"] === true,
    logoKey: strOrNull(raw["logoKey"]),
    sourceHost: strOrNull(raw["sourceHost"]),
    updatedAt: str(raw["updatedAt"]),
  };
}

function themesPath(workspaceId: string): `/${string}` {
  return `/workspaces/${encodeURIComponent(workspaceId)}/themes`;
}

function themePath(workspaceId: string, themeId: string): `/${string}` {
  return `${themesPath(workspaceId)}/${encodeURIComponent(themeId)}`;
}

/**
 * The lock travels with the list so a caller who reads themes learns it without a read of
 * workspace settings, which is an administrator's to make.
 */
export interface WorkspaceThemeList {
  readonly themes: readonly WorkspaceTheme[];
  readonly appearanceLocked: boolean;
}

export async function listWorkspaceThemes(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<WorkspaceThemeList>> {
  const result = await readResult<{ themes?: unknown; appearanceLocked?: unknown }>(
    await adminApiFetch(session, themesPath(workspaceId)),
  );
  if (!result.ok) return result;
  const rows = Array.isArray(result.data.themes) ? result.data.themes : [];
  return {
    ok: true,
    data: {
      themes: rows.flatMap((row) => {
        const theme = parseTheme(row as Record<string, unknown>);
        return theme === undefined ? [] : [theme];
      }),
      appearanceLocked: result.data.appearanceLocked === true,
    },
  };
}

/** The whole theme goes back, because the route replaces the row rather than patching it. */
export async function renameWorkspaceTheme(
  session: AdminSession,
  workspaceId: string,
  theme: WorkspaceTheme,
  name: string,
): Promise<ApiResult<unknown>> {
  return readResult<unknown>(
    await adminApiFetch(session, themePath(workspaceId, theme.themeId), {
      method: "PUT",
      body: {
        name,
        palettes: theme.palettes,
        face: theme.face,
        corners: theme.corners,
        pageTint: theme.pageTint,
        logoKey: theme.logoKey,
        sourceHost: theme.sourceHost,
      },
    }),
  );
}

export async function deleteWorkspaceTheme(
  session: AdminSession,
  workspaceId: string,
  themeId: string,
): Promise<ApiResult<null>> {
  return readNoContent(
    await adminApiFetch(session, themePath(workspaceId, themeId), { method: "DELETE" }),
  );
}

export async function uploadWorkspaceThemeLogo(
  session: AdminSession,
  workspaceId: string,
  themeId: string,
  bytesBase64: string,
): Promise<ApiResult<{ readonly logoKey?: unknown }>> {
  return readResult<{ logoKey?: unknown }>(
    await adminApiFetch(session, `${themePath(workspaceId, themeId)}/logo` as `/${string}`, {
      method: "POST",
      body: { bytesBase64 },
    }),
  );
}

export async function setWorkspaceAppearanceLock(
  session: AdminSession,
  workspaceId: string,
  locked: boolean,
): Promise<ApiResult<{ readonly appearanceLocked: boolean }>> {
  const result = await readResult<{ appearanceLocked?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/appearance-lock`, {
      method: "PUT",
      body: { locked },
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: { appearanceLocked: result.data.appearanceLocked === true } };
}

export function themeOption(theme: WorkspaceTheme): ThemeOption {
  return {
    key: workspaceThemeKey(theme.themeId),
    name: theme.name,
    palettes: theme.palettes,
    face: theme.face as ThemeOption["face"],
    corners: theme.corners as ThemeOption["corners"],
    pageTint: theme.pageTint,
    logo: theme.logoKey,
  };
}
