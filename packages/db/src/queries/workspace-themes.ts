import { Buffer } from "node:buffer";

import { and, asc, eq, sql } from "drizzle-orm";

import type {
  AppearanceCorners,
  AppearanceFace,
  AppearancePalettes,
  RasterLogoContentType,
} from "@roonga/qcms-core";

import {
  APPEARANCE_LOGOS_TAKEN_DOWN,
  WORKSPACE_THEMES_LOGO_KEY_FK,
  appearanceLogos,
  workspaceThemes,
} from "../schema/index.js";
import type { Executor } from "./executor.js";

/**
 * A workspace theme. Nothing on a form points at one: applying a theme copies these
 * fields into the draft by value (`docs/WORKSPACE_ACCESS.md` section 9).
 */
export interface WorkspaceThemeRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly palettes: AppearancePalettes;
  readonly face: AppearanceFace;
  readonly corners: AppearanceCorners;
  readonly pageTint: boolean;
  readonly logoKey: string | null;
  readonly sourceHost: string | null;
  readonly updatedAt: Date;
}

const themeColumns = {
  id: workspaceThemes.id,
  workspaceId: workspaceThemes.workspaceId,
  name: workspaceThemes.name,
  palettes: workspaceThemes.palettes,
  face: workspaceThemes.face,
  corners: workspaceThemes.corners,
  pageTint: workspaceThemes.pageTint,
  logoKey: workspaceThemes.logoKey,
  sourceHost: workspaceThemes.sourceHost,
  updatedAt: workspaceThemes.updatedAt,
} as const;

/** One workspace's themes, by name, so a list is stable between reads. */
export async function listWorkspaceThemes(
  exec: Executor,
  workspaceId: string,
): Promise<WorkspaceThemeRow[]> {
  return exec
    .select(themeColumns)
    .from(workspaceThemes)
    .where(eq(workspaceThemes.workspaceId, workspaceId))
    .orderBy(asc(workspaceThemes.name), asc(workspaceThemes.id));
}

/**
 * One theme, found only inside the workspace the caller was authorised for. The workspace
 * is part of the predicate rather than checked afterwards, so a theme id from another
 * workspace reads as absent.
 */
export async function getWorkspaceTheme(
  exec: Executor,
  workspaceId: string,
  themeId: string,
): Promise<WorkspaceThemeRow | undefined> {
  const [row] = await exec
    .select(themeColumns)
    .from(workspaceThemes)
    .where(and(eq(workspaceThemes.workspaceId, workspaceId), eq(workspaceThemes.id, themeId)))
    .limit(1);
  return row;
}

export interface WorkspaceThemeInput {
  readonly name: string;
  readonly palettes: AppearancePalettes;
  readonly face: AppearanceFace;
  readonly corners: AppearanceCorners;
  readonly pageTint: boolean;
  readonly logoKey: string | null;
  readonly sourceHost: string | null;
}

/** A name already used in the workspace violates `workspace_themes_workspace_name`. */
export async function insertWorkspaceTheme(
  exec: Executor,
  input: WorkspaceThemeInput & { readonly workspaceId: string; readonly actor: string | null },
): Promise<WorkspaceThemeRow> {
  const [row] = await exec
    .insert(workspaceThemes)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      palettes: input.palettes,
      face: input.face,
      corners: input.corners,
      pageTint: input.pageTint,
      logoKey: input.logoKey,
      sourceHost: input.sourceHost,
      createdBy: input.actor,
      updatedBy: input.actor,
    })
    .returning(themeColumns);
  if (row === undefined) throw new Error("the workspace theme insert returned no row");
  return row;
}

/** Replaces every stored field, so a change is one write and never a merge of two reads. */
export async function updateWorkspaceTheme(
  exec: Executor,
  input: WorkspaceThemeInput & {
    readonly workspaceId: string;
    readonly themeId: string;
    readonly actor: string | null;
    readonly now: Date;
  },
): Promise<WorkspaceThemeRow | undefined> {
  const [row] = await exec
    .update(workspaceThemes)
    .set({
      name: input.name,
      palettes: input.palettes,
      face: input.face,
      corners: input.corners,
      pageTint: input.pageTint,
      logoKey: input.logoKey,
      sourceHost: input.sourceHost,
      updatedBy: input.actor,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(workspaceThemes.workspaceId, input.workspaceId),
        eq(workspaceThemes.id, input.themeId),
      ),
    )
    .returning(themeColumns);
  return row;
}

/** Removes the theme row alone. The logo bytes it named outlive it until a takedown. */
export async function deleteWorkspaceTheme(
  exec: Executor,
  workspaceId: string,
  themeId: string,
): Promise<boolean> {
  const deleted = await exec
    .delete(workspaceThemes)
    .where(and(eq(workspaceThemes.workspaceId, workspaceId), eq(workspaceThemes.id, themeId)))
    .returning({ id: workspaceThemes.id });
  return deleted.length > 0;
}

/**
 * Store logo bytes under the SHA-256 the caller computed. Content-addressed and immutable,
 * so re-storing the same image is a no-op rather than a conflict; the CHECK on the table
 * is what makes the key and the bytes agree. Bytes that were taken down are refused with
 * {@link APPEARANCE_LOGOS_TAKEN_DOWN}, which {@link isLogoTakenDown} recognises.
 */
export async function insertAppearanceLogo(
  exec: Executor,
  input: {
    readonly key: string;
    readonly contentType: RasterLogoContentType;
    readonly bytes: Uint8Array;
    readonly actor: string | null;
  },
): Promise<void> {
  await exec
    .insert(appearanceLogos)
    .values({
      key: input.key,
      contentType: input.contentType,
      // `bytea` binds a `Buffer`, which the driver owns: a handler stays on Web APIs and
      // hands over a plain view.
      bytes: Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength),
      createdBy: input.actor,
    })
    .onConflictDoNothing({ target: appearanceLogos.key });
}

export interface AppearanceLogoRow {
  readonly key: string;
  readonly contentType: RasterLogoContentType;
  readonly bytes: Uint8Array;
}

/**
 * The three columns an environment role holds `SELECT` on, and no more: the serving pool
 * answers with the bytes and the type, and is granted nothing about who stored one or
 * when (`CONTROL_READ_COLUMNS`).
 */
export async function getAppearanceLogo(
  exec: Executor,
  key: string,
): Promise<AppearanceLogoRow | undefined> {
  const [row] = await exec
    .select({
      key: appearanceLogos.key,
      contentType: appearanceLogos.contentType,
      bytes: appearanceLogos.bytes,
    })
    .from(appearanceLogos)
    .where(eq(appearanceLogos.key, key))
    .limit(1);
  return row;
}

/**
 * Clear a taken-down key off every theme that names it. The themes' foreign key forbids a
 * dangling reference, so this runs in the takedown's own transaction before the bytes go;
 * a draft or a version carries its appearance by value and keeps the key it froze.
 */
export async function clearThemeLogoKey(
  exec: Executor,
  key: string,
): Promise<{ readonly themesCleared: number; readonly workspaceIds: readonly string[] }> {
  const cleared = await exec
    .update(workspaceThemes)
    .set({ logoKey: null })
    .where(eq(workspaceThemes.logoKey, key))
    .returning({ workspaceId: workspaceThemes.workspaceId });
  const workspaceIds = [...new Set(cleared.map((row) => row.workspaceId))].sort();
  return { themesCleared: cleared.length, workspaceIds };
}

/**
 * Delete stored logo bytes through migration 0012's sanctioned function, which also
 * records the digest so the store refuses those bytes from then on. False where nothing
 * was stored.
 */
export async function takeDownAppearanceLogo(exec: Executor, key: string): Promise<boolean> {
  const result = await exec.execute<{ taken_down: boolean }>(
    sql`select control.appearance_logo_takedown(${key}) as taken_down`,
  );
  return result.rows[0]?.taken_down === true;
}

function violates(err: unknown, constraint: string): boolean {
  for (let e: unknown = err; typeof e === "object" && e !== null;) {
    if ((e as { constraint?: unknown }).constraint === constraint) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** True where `err` is the store's refusal of a taken-down digest. */
export function isLogoTakenDown(err: unknown): boolean {
  return violates(err, APPEARANCE_LOGOS_TAKEN_DOWN);
}

/** True where `err` is the themes' logo foreign key, and no other constraint. */
export function isThemeLogoKeyViolation(err: unknown): boolean {
  return violates(err, WORKSPACE_THEMES_LOGO_KEY_FK);
}
