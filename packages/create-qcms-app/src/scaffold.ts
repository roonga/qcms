/**
 * Stamping the tree (task 037).
 *
 * Deliberately I/O and nothing else: what to write is decided by `templates.ts` and
 * `render.ts`, what goes in `.env` by `env-file.ts`. This module's only judgement is
 * the refusal at the top, and that one matters: a scaffolder that writes into a
 * directory someone already has work in is a data-loss bug, so an existing non-empty
 * target stops the run unless `--force` says otherwise.
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { fillEnv } from "./env-file.js";
import type { ScaffoldOptions } from "./options.js";
import { renderTemplate, templateValues } from "./render.js";
import { readTemplate, templateFiles, TEMPLATE_ROOT } from "./templates.js";

/** What a scaffold run produced. */
export interface ScaffoldResult {
  /** Scaffold-relative paths written, sorted. */
  readonly files: readonly string[];
  /** Mandatory variables `.env` still needs an answer for. */
  readonly unresolvedEnv: readonly string[];
}

/** Thrown when the target directory already holds files. */
export class TargetNotEmpty extends Error {
  constructor(directory: string) {
    super(
      `${directory} already has files in it. Choose an empty directory, or pass --force to stamp into this one.`,
    );
    this.name = "TargetNotEmpty";
  }
}

function assertUsableTarget(directory: string, force: boolean): void {
  let entries: string[];
  try {
    if (!statSync(directory).isDirectory()) throw new TargetNotEmpty(directory);
    entries = readdirSync(directory);
  } catch (error) {
    if (error instanceof TargetNotEmpty) throw error;
    return; // Nothing there yet, which is the ordinary case.
  }
  if (entries.length > 0 && !force) throw new TargetNotEmpty(directory);
}

/** The environment values that come from the operator's answers rather than the CSPRNG. */
export function answeredEnv(options: ScaffoldOptions): Readonly<Record<string, string>> {
  return {
    QCMS_PORTAL_BASE_URL: options.portalBaseUrl,
    QCMS_ADMIN_BASE_URL: options.adminBaseUrl,
    QCMS_ADMIN_2FA: options.adminTwoFactor,
  };
}

/**
 * Write the whole tree, then `.env` beside it.
 *
 * `.env` is derived from the `.env.example` this run just rendered, not from a
 * second list: the file the operator edits and the file documenting it are the same
 * document, one filled in.
 */
export function scaffold(options: ScaffoldOptions, root: string = TEMPLATE_ROOT): ScaffoldResult {
  assertUsableTarget(options.targetDirectory, options.force);
  const values = templateValues(options);
  const written: string[] = [];
  let envExample: string | undefined;

  for (const file of templateFiles(options.shape, root).values()) {
    const raw = readTemplate(file);
    const contents = file.rendered ? renderTemplate(raw, values, file.output) : raw;
    writeInto(options.targetDirectory, file.output, contents);
    written.push(file.output);
    if (file.output === ".env.example") envExample = contents;
  }

  if (envExample === undefined) {
    throw new Error("The template tree produced no .env.example, so no .env can be derived.");
  }
  const filled = fillEnv(envExample, answeredEnv(options));
  writeInto(options.targetDirectory, ".env", filled.text);
  written.push(".env");

  return { files: [...written].sort(), unresolvedEnv: filled.unresolved };
}

function writeInto(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}
