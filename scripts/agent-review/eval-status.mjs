// @ts-check
/**
 * The run status a review run keeps in its lane scratch directory, so a monitor outside the run
 * can show progress without reading a transcript. The shape is fixed: a reader depends on it.
 * Every write replaces the whole file through a rename, so a reader never sees half of one.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

export const STATUS_FILE_NAME = "eval-status.json";

export const STATES = ["queued", "running", "run", "checked", "reviewing", "reviewed", "not-run"];

export const SEVERITIES = ["fail", "warn"];

export const VERDICTS = ["pass", "fail", "mixed"];

export const FINDING_KINDS = [
  "prompt",
  "tool description",
  "interface wording",
  "layout",
  "missing capability",
];

/** Long enough for a check's own message, short enough that no transcript fits. */
export const MAX_TEXT = 240;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * @param {string} where
 * @param {unknown} value
 * @param {string[]} problems
 */
function checkText(where, value, problems) {
  if (typeof value !== "string") {
    problems.push(`${where} must be a string`);
    return;
  }
  if (value.length > MAX_TEXT)
    problems.push(`${where} is longer than ${String(MAX_TEXT)} characters`);
  if (value.includes("://")) problems.push(`${where} carries an address; this file holds none`);
}

/**
 * @param {{ runId: string; startedAt: string; stack: { adminUrl: string; promptVersion?: string;
 *   headSha?: string }; scenarios: readonly { id: string; title: string; budget: number }[] }} run
 * @returns {Record<string, unknown>}
 */
export function createStatus({ runId, startedAt, stack, scenarios }) {
  return {
    runId,
    startedAt,
    updatedAt: startedAt,
    stack: { ...stack },
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      state: "queued",
      turns: 0,
      budget: scenario.budget,
      checks: { exit: null, findings: [] },
      review: { verdict: null, findings: [] },
      note: "",
    })),
  };
}

/**
 * Merges a patch into one scenario and stamps `updatedAt`. `checks` and `review` merge a level
 * deeper, so a state change does not have to restate findings it is not touching.
 *
 * @param {Record<string, unknown>} status
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @param {string} now
 * @returns {Record<string, unknown>}
 */
export function withScenario(status, id, patch, now) {
  const listed = Array.isArray(status["scenarios"]) ? status["scenarios"] : [];
  const found = listed.some((entry) => isRecord(entry) && entry["id"] === id);
  if (!found) throw new Error(`no scenario '${id}' in this status file`);

  const scenarios = listed.map((entry) => {
    const scenario = /** @type {Record<string, unknown>} */ (entry);
    if (scenario["id"] !== id) return scenario;
    const merged = { ...scenario, ...patch };
    for (const key of ["checks", "review"]) {
      const update = patch[key];
      if (isRecord(update)) {
        const current = isRecord(scenario[key]) ? scenario[key] : {};
        merged[key] = { ...current, ...update };
      }
    }
    return merged;
  });
  return { ...status, updatedAt: now, scenarios };
}

/**
 * @param {Record<string, unknown>} scenario
 * @param {string} where
 * @param {string[]} problems
 */
function validateScenario(scenario, where, problems) {
  for (const key of ["id", "title"]) {
    if (typeof scenario[key] !== "string" || scenario[key] === "") {
      problems.push(`${where}.${key} must be a non-empty string`);
    }
  }
  if (!STATES.includes(/** @type {string} */ (scenario["state"]))) {
    problems.push(`${where}.state must be one of ${STATES.join(", ")}`);
  }
  for (const key of ["turns", "budget"]) {
    if (!isCount(scenario[key])) problems.push(`${where}.${key} must be a whole number of turns`);
  }
  checkText(`${where}.note`, scenario["note"], problems);

  const checks = scenario["checks"];
  if (!isRecord(checks)) problems.push(`${where}.checks must be an object`);
  else {
    const exit = checks["exit"];
    if (exit !== null && exit !== 0 && exit !== 1 && exit !== 2) {
      problems.push(`${where}.checks.exit must be 0, 1, 2 or null`);
    }
    const findings = checks["findings"];
    if (!Array.isArray(findings)) problems.push(`${where}.checks.findings must be an array`);
    else {
      findings.forEach((entry, index) => {
        const at = `${where}.checks.findings[${String(index)}]`;
        if (!isRecord(entry)) {
          problems.push(`${at} must be an object`);
          return;
        }
        if (typeof entry["id"] !== "string" || entry["id"] === "") {
          problems.push(`${at}.id must be a non-empty string`);
        }
        if (!SEVERITIES.includes(/** @type {string} */ (entry["severity"]))) {
          problems.push(`${at}.severity must be one of ${SEVERITIES.join(", ")}`);
        }
        checkText(`${at}.text`, entry["text"], problems);
      });
    }
  }

  const review = scenario["review"];
  if (!isRecord(review)) problems.push(`${where}.review must be an object`);
  else {
    const verdict = review["verdict"];
    if (verdict !== null && !VERDICTS.includes(/** @type {string} */ (verdict))) {
      problems.push(`${where}.review.verdict must be one of ${VERDICTS.join(", ")} or null`);
    }
    const findings = review["findings"];
    if (!Array.isArray(findings)) problems.push(`${where}.review.findings must be an array`);
    else {
      findings.forEach((entry, index) => {
        const at = `${where}.review.findings[${String(index)}]`;
        if (!isRecord(entry)) {
          problems.push(`${at} must be an object`);
          return;
        }
        if (!FINDING_KINDS.includes(/** @type {string} */ (entry["kind"]))) {
          problems.push(`${at}.kind must be one of ${FINDING_KINDS.join(", ")}`);
        }
        checkText(`${at}.text`, entry["text"], problems);
      });
    }
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateStatus(value) {
  /** @type {string[]} */
  const problems = [];
  if (!isRecord(value)) return ["the status must be a JSON object"];

  if (typeof value["runId"] !== "string" || value["runId"] === "") {
    problems.push("runId must be a non-empty string");
  }
  for (const key of ["startedAt", "updatedAt"]) {
    if (!isTimestamp(value[key])) problems.push(`${key} must be a timestamp`);
  }

  const stack = value["stack"];
  if (!isRecord(stack)) problems.push("stack must be an object");
  else {
    if (typeof stack["adminUrl"] !== "string" || stack["adminUrl"] === "") {
      problems.push("stack.adminUrl must be a non-empty string");
    }
    for (const key of ["promptVersion", "headSha"]) {
      if (stack[key] !== undefined && typeof stack[key] !== "string") {
        problems.push(`stack.${key} must be a string when it is there`);
      }
    }
  }

  const scenarios = value["scenarios"];
  if (!Array.isArray(scenarios)) problems.push("scenarios must be an array");
  else {
    scenarios.forEach((entry, index) => {
      const where = `scenarios[${String(index)}]`;
      if (!isRecord(entry)) problems.push(`${where} must be an object`);
      else validateScenario(entry, where, problems);
    });
  }
  return problems;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function assertValid(value) {
  const problems = validateStatus(value);
  if (problems.length > 0) throw new Error(`the status file is wrong:\n  ${problems.join("\n  ")}`);
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * A reader polls this file, so it is replaced whole: written beside itself and renamed, which
 * is atomic within one directory.
 *
 * @param {string} path
 * @param {Record<string, unknown>} status
 * @returns {string}
 */
export function writeStatus(path, status) {
  assertValid(status);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${STATUS_FILE_NAME}.${randomBytes(6).toString("hex")}`);
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(temporary, path);
  return path;
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
export function readStatus(path) {
  return assertValid(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * @typedef {Omit<Parameters<typeof createStatus>[0], "startedAt"> & { startedAt?: string }} NewRun
 */

/**
 * `init <file> <json>` writes a new status, `set <file> <id> <json>` patches one scenario and
 * `check <file>` reports what is wrong with one. No argument carries a secret.
 *
 * @param {readonly string[]} args
 * @param {string} now
 * @returns {number}
 */
export function main(args, now) {
  const [command, path, ...rest] = args;
  if (command === "init" && path !== undefined && rest[0] !== undefined) {
    const run = /** @type {NewRun} */ (JSON.parse(rest[0]));
    writeStatus(path, createStatus({ ...run, startedAt: run.startedAt ?? now }));
    stdout.write(`agent-review: status for ${run.runId} in ${path}\n`);
    return 0;
  }
  if (command === "set" && path !== undefined && rest[0] !== undefined && rest[1] !== undefined) {
    const updated = withScenario(readStatus(path), rest[0], JSON.parse(rest[1]), now);
    writeStatus(path, updated);
    stdout.write(`agent-review: ${rest[0]} updated in ${path}\n`);
    return 0;
  }
  if (command === "check" && path !== undefined) {
    readStatus(path);
    stdout.write(`agent-review: ${path} matches the status shape\n`);
    return 0;
  }
  stderr.write(
    "usage: eval-status.mjs init <file> <json> | set <file> <scenario> <json> | check <file>\n",
  );
  return 2;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    exit(main(argv.slice(2), new Date().toISOString()));
  } catch (error) {
    stderr.write(`agent-review: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(2);
  }
}
