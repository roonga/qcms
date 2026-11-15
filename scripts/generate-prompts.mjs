#!/usr/bin/env node
// @ts-check
/**
 * Builds the assistant's `prompts.generated.ts` from the Markdown beside it: `--write`
 * generates, `--check` fails on a stale copy and on prompt text whose recorded hash or
 * version no longer matches its sources.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { argv, env, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format, resolveConfig } from "prettier";

import { PROMPT_SOURCE_DIRS, PROMPT_SOURCE_PREFIX } from "./prompt-sources.mjs";

const REPO_ROOT = new URL("../", import.meta.url);

export const GENERATED_PATH = `${PROMPT_SOURCE_PREFIX}prompts.generated.ts`;

/** The file that records the version and the hash the sources are held to. */
export const VERSION_PATH = "apps/api/src/features/agent/system-prompt.ts";

/** The values `buildSystemPrompt` computes from the kernel, written as `{{NAME}}`. */
export const PLACEHOLDERS = [
  "AVOID_WORDS",
  "QUESTION_TYPES",
  "ANSWER_ENCODINGS",
  "VALIDATION_MESSAGE_KEYS",
  "SEMANTICS_VERSION",
  "CONDITION_OPERATORS",
];

const PLACEHOLDER = /\{\{(\w*)\}\}/g;

const HEADER =
  "// Generated from the Markdown in this folder by `pnpm prompts:generate`. Do not edit.";

/**
 * One prompt source: its repo-relative path, its file stem, and its text without the
 * trailing newline a text file carries.
 *
 * @typedef {{ path: string; name: string; text: string }} PromptSource
 */

/**
 * Every Markdown file in one source directory, in name order.
 *
 * @param {string} directory one of {@link PROMPT_SOURCE_DIRS}
 * @returns {PromptSource[]}
 */
export function readSources(directory) {
  const base = `${PROMPT_SOURCE_PREFIX}${directory}`;
  return readdirSync(new URL(base, REPO_ROOT), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .map((file) => ({
      path: `${base}/${file}`,
      name: file.slice(0, -".md".length),
      text: readFileSync(new URL(`${base}/${file}`, REPO_ROOT), "utf8").replace(/\n$/, ""),
    }));
}

/**
 * A description as a tool schema carries it: one line, which is what the wrapping in the
 * Markdown is for.
 *
 * @param {string} text
 * @returns {string}
 */
export function unwrapDescription(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
}

/**
 * The placeholder names one source uses.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function placeholdersIn(text) {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/**
 * @param {PromptSource[]} sources
 * @returns {string[]} one message per source using a placeholder nothing fills
 */
export function placeholderProblems(sources) {
  /** @type {string[]} */
  const problems = [];
  for (const source of sources) {
    for (const name of placeholdersIn(source.text)) {
      if (PLACEHOLDERS.includes(name)) continue;
      problems.push(
        `${source.path} uses {{${name}}}, which nothing fills. The values buildSystemPrompt ` +
          `computes are: ${PLACEHOLDERS.join(", ")}.`,
      );
    }
  }
  return problems;
}

/**
 * @param {PromptSource[]} sources tool and action descriptions
 * @returns {string[]} one message per description a tool schema could not carry
 */
export function descriptionProblems(sources) {
  /** @type {string[]} */
  const problems = [];
  for (const source of sources) {
    if (unwrapDescription(source.text) === "") problems.push(`${source.path} is empty.`);
    if (placeholdersIn(source.text).length > 0) {
      problems.push(`${source.path} uses a placeholder, and a description fills none.`);
    }
  }
  return problems;
}

/**
 * The hash the recorded one is compared against: every source's name and bytes in a
 * fixed order, so nothing about the file system can change it.
 *
 * @param {Record<string, PromptSource[]>} byDirectory
 * @returns {string}
 */
export function sourceHash(byDirectory) {
  const hash = createHash("sha256");
  for (const directory of PROMPT_SOURCE_DIRS) {
    for (const source of byDirectory[directory] ?? []) {
      hash.update(`${directory}/${source.name}\n${source.text}\n`);
    }
  }
  return hash.digest("hex");
}

/**
 * @param {string} name
 * @param {PromptSource[]} sources
 * @returns {string}
 */
function renderRecord(name, sources) {
  const entries = sources.map((source) => {
    return `  ${JSON.stringify(source.name)}: ${JSON.stringify(unwrapDescription(source.text))},`;
  });
  return [`export const ${name} = {`, ...entries, "} as const;"].join("\n");
}

/**
 * @param {Record<string, PromptSource[]>} byDirectory
 * @returns {string} the module before Prettier formats it
 */
export function renderModule(byDirectory) {
  const sections = (byDirectory.system ?? []).map(
    (source) => `  // ${source.name}.md\n  ${JSON.stringify(source.text)},`,
  );
  return [
    HEADER,
    "",
    "/** The system prompt's sections in order; `buildSystemPrompt` fills each `{{NAME}}`. */",
    "export const SYSTEM_PROMPT_SECTIONS: readonly string[] = [",
    ...sections,
    "];",
    "",
    "/** One per tool in the registry, keyed by tool name. */",
    renderRecord("TOOL_DESCRIPTIONS", byDirectory.tools ?? []),
    "",
    "/** One per action kind, keyed by the kind a proposed step names. */",
    renderRecord("ACTION_DESCRIPTIONS", byDirectory.actions ?? []),
    "",
  ].join("\n");
}

/**
 * The version and hash a `system-prompt.ts` records.
 *
 * @param {string} text
 * @returns {{ version: number | undefined; hash: string | undefined }}
 */
export function recorded(text) {
  const version = /export const SYSTEM_PROMPT_VERSION = (\d+);/.exec(text)?.[1];
  const hash = /export const PROMPT_SOURCE_HASH =\s*"([0-9a-f]{64})";/.exec(text)?.[1];
  return { version: version === undefined ? undefined : Number(version), hash };
}

/**
 * The bump rule: text that changed since the base revision carries a higher version.
 *
 * @param {string} baseText `system-prompt.ts` as the base revision has it
 * @param {string} headText the same file now
 * @returns {string | undefined}
 */
export function bumpProblem(baseText, headText) {
  const base = recorded(baseText);
  const head = recorded(headText);
  if (base.hash === undefined || head.hash === undefined || base.hash === head.hash) {
    return undefined;
  }
  if (base.version === undefined || head.version === undefined) return undefined;
  if (head.version > base.version) return undefined;
  return (
    `the prompt hash changed and SYSTEM_PROMPT_VERSION is still ${String(head.version)}. It is ` +
    `logged with every turn, so changed prompt text needs a new one: set it to ` +
    `${String(base.version + 1)}.`
  );
}

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, REPO_ROOT), "utf8");
}

/** @param {string[]} args */
function tryGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: fileURLToPath(REPO_ROOT),
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
}

/** The base revision's copy of {@link VERSION_PATH}, or nothing when no base ref exists. */
function baseVersionFile() {
  const branch = env.DEFAULT_BRANCH ?? "main";
  for (const ref of [`origin/${branch}`, branch]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === undefined) continue;
    const base = tryGit(["merge-base", ref, "HEAD"]) ?? ref;
    return tryGit(["show", `${base}:${VERSION_PATH}`]);
  }
  return undefined;
}

async function generated() {
  /** @type {Record<string, PromptSource[]>} */
  const byDirectory = {};
  for (const directory of PROMPT_SOURCE_DIRS) byDirectory[directory] = readSources(directory);
  const problems = [
    ...placeholderProblems(byDirectory.system ?? []),
    ...descriptionProblems([...(byDirectory.tools ?? []), ...(byDirectory.actions ?? [])]),
  ];
  if (problems.length > 0) {
    throw new Error(
      `generate-prompts: the Markdown sources are wrong.\n  ${problems.join("\n  ")}`,
    );
  }
  const absolute = fileURLToPath(new URL(GENERATED_PATH, REPO_ROOT));
  const prettier = (await resolveConfig(absolute)) ?? {};
  return {
    module: await format(renderModule(byDirectory), { ...prettier, filepath: absolute }),
    hash: sourceHash(byDirectory),
  };
}

async function write() {
  const { module, hash } = await generated();
  writeFileSync(new URL(GENERATED_PATH, REPO_ROOT), module, "utf8");
  console.log(`generate-prompts: wrote ${GENERATED_PATH}.`);
  if (recorded(read(VERSION_PATH)).hash !== hash) {
    console.log(
      `generate-prompts: the prompt text changed. Record PROMPT_SOURCE_HASH = "${hash}" in ` +
        `${VERSION_PATH} and bump SYSTEM_PROMPT_VERSION beside it.`,
    );
  }
  return 0;
}

async function check() {
  const { module, hash } = await generated();
  /** @type {string[]} */
  const failures = [];
  if (read(GENERATED_PATH) !== module) {
    failures.push(`${GENERATED_PATH} is stale: run \`pnpm prompts:generate\`.`);
  }
  const versionText = read(VERSION_PATH);
  const recordedHash = recorded(versionText).hash;
  if (recordedHash !== hash) {
    failures.push(
      `${VERSION_PATH} records PROMPT_SOURCE_HASH ${String(recordedHash)} and the sources hash ` +
        `to ${hash}. Record the new hash there and bump SYSTEM_PROMPT_VERSION beside it.`,
    );
  }
  const base = baseVersionFile();
  if (base === undefined) {
    console.warn("check-prompts: no base revision to diff against; skipping the bump rule.");
  } else {
    const problem = bumpProblem(base, versionText);
    if (problem !== undefined) failures.push(`${VERSION_PATH}: ${problem}`);
  }
  if (failures.length > 0) {
    console.error("check-prompts: the assistant's prompt sources are out of step:\n");
    for (const failure of failures) console.error(`  ${failure}`);
    console.error("");
    return 1;
  }
  console.log(`check-prompts: OK - ${GENERATED_PATH} matches its Markdown (hash ${hash}).`);
  return 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  const mode = argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: node scripts/generate-prompts.mjs --write | --check");
    exit(2);
  }
  exit(await (mode === "--write" ? write() : check()));
}
