import {
  DEFAULT_CORNERS,
  DEFAULT_DENSITY,
  DEFAULT_PROGRESS,
  workspaceThemeKey,
  type DerivedTheme,
  type NewWorkspaceTheme,
  type ThemeCorrection,
  type ThemeOption,
  type ThemePalettes,
} from "../forms/appearance-edit.ts";
import { parseDraftAppearance } from "../forms/preview-appearance.ts";
import { messageForFormCode } from "../forms/errors.ts";
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

function correction(raw: unknown): ThemeCorrection | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const fields = ["palette", "token", "from", "to"].map((name) => row[name]);
  if (!fields.every((value) => typeof value === "string" && value !== "")) return undefined;
  const [palette, token, from, to] = fields as [string, string, string, string];
  return { palette, token, from, to };
}

/**
 * Reads only the fields the derive schema names, so an envelope carrying anything else is a
 * refusal rather than a theme. The corners, density and progress are not the website's: a
 * derive answers colours, a face and a tint, and the drawer keeps the rest where it was.
 */
function parseDerived(raw: unknown): DerivedTheme | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const appearance = parseDraftAppearance({
    palettes: row["palettes"],
    face: row["face"],
    corners: DEFAULT_CORNERS,
    density: DEFAULT_DENSITY,
    progress: DEFAULT_PROGRESS,
  });
  if (appearance === null) return undefined;
  const tintDropped = Array.isArray(row["tintDropped"]) ? row["tintDropped"] : [];
  return {
    palettes: appearance.palettes,
    face: appearance.face,
    pageTint: row["pageTint"] === true,
    logoKey: strOrNull(row["logoKey"]),
    corrections: Array.isArray(row["corrections"])
      ? row["corrections"].flatMap((entry) => {
          const parsed = correction(entry);
          return parsed === undefined ? [] : [parsed];
        })
      : [],
    tintDropped: tintDropped.filter((kind): kind is string => typeof kind === "string"),
  };
}

/**
 * Reads one website for a look, through the API's SEC-18 fetcher. The address is the one the
 * user typed: no admin or agent code fetches it, and nothing is saved as a theme here.
 */
export async function deriveWorkspaceTheme(
  session: AdminSession,
  workspaceId: string,
  url: string,
): Promise<ApiResult<DerivedTheme>> {
  const result = await readResult<{ derived?: unknown }>(
    await adminApiFetch(session, `${themesPath(workspaceId)}/derive` as `/${string}`, {
      method: "POST",
      body: { url },
    }),
  );
  if (!result.ok) return result;
  const derived = parseDerived(result.data.derived);
  if (derived === undefined) {
    return {
      ok: false,
      code: "INVALID_THEME",
      message: messageForFormCode("INVALID_THEME"),
      issues: [],
    };
  }
  return { ok: true, data: derived };
}

/**
 * The route answers the saved row under `theme`, and the name it answers is the stored one, which
 * is what the drawer tells the person it kept. A body without that row is a refusal here rather
 * than a success sentence naming nothing.
 */
export async function createWorkspaceTheme(
  session: AdminSession,
  workspaceId: string,
  theme: NewWorkspaceTheme,
): Promise<ApiResult<{ readonly themeId: string; readonly name: string }>> {
  const result = await readResult<{ theme?: unknown }>(
    await adminApiFetch(session, themesPath(workspaceId), { method: "POST", body: theme }),
  );
  if (!result.ok) return result;
  const row = result.data.theme;
  const saved = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
  const themeId = str(saved["themeId"]);
  const name = str(saved["name"]);
  if (themeId === "" || name === "") {
    return {
      ok: false,
      code: "INVALID_THEME",
      message: messageForFormCode("INVALID_THEME"),
      issues: [],
    };
  }
  return { ok: true, data: { themeId, name } };
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
