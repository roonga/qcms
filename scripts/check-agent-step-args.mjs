#!/usr/bin/env node
// @ts-check
/**
 * The browser reads a confirmed step's arguments by name and cannot import the API's kind
 * registry, so this holds the two together: every advertised argument is read by a runner,
 * every name a runner reads is advertised, and every kind reaching a route has a runner.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const RENDERED_TOOLS = "apps/api/src/features/agent/prompts/rendered/tools.json";

export const STEP_ACTIONS = "apps/admin/components/agent/step-actions.ts";

/**
 * The kinds no runner completes, because what they act on exists only on the screen: the
 * export's bytes stream from its own download control, and the two theme acts need the
 * address the person types on the card and the look the appearance drawer is showing.
 */
export const HANDED_OFF_KINDS = ["response.export", "theme.derive", "theme.save"];

/**
 * The environment a step acts in is bound by its token and reaches the runner as
 * `step.environment`, so a runner reads it off the step rather than off the arguments even
 * for the two kinds that advertise it.
 */
export const STEP_BOUND_ARGUMENTS = ["environment"];

const ARGUMENT_READ = /\bargs\[(?<quote>["'])(?<name>[\w.]+)\k<quote>\]/gu;

const RUNNER_KEY = /^\s{2}"(?<kind>[\w.-]+)":/gmu;

/** Each kind the propose tool advertises, with the arguments a step of it may name. */
export function advertisedKinds(renderedToolsJson) {
  const tools = JSON.parse(renderedToolsJson);
  const propose = tools.find((tool) => tool.name === "propose_plan");
  if (propose === undefined) return {};
  const items = propose.inputSchema?.properties?.steps?.items ?? {};
  const arms = items.anyOf ?? items.oneOf ?? [items];
  const kinds = {};
  for (const arm of arms) {
    const kind = arm.properties?.kind?.const;
    if (typeof kind !== "string") continue;
    kinds[kind] = Object.keys(arm.properties?.args?.properties ?? {}).sort();
  }
  return kinds;
}

/** What the runner module reads: the kinds it keys on, and the argument names it names. */
export function runnerReads(source) {
  return {
    kinds: [...source.matchAll(RUNNER_KEY)].map((match) => match.groups?.kind ?? ""),
    names: [...new Set([...source.matchAll(ARGUMENT_READ)].map((m) => m.groups?.name ?? ""))],
  };
}

function missing(wanted, got) {
  return wanted.filter((name) => !got.includes(name));
}

export function checkStepArguments(renderedToolsJson, source) {
  const kinds = advertisedKinds(renderedToolsJson);
  const advertised = Object.keys(kinds);
  const { kinds: runners, names } = runnerReads(source);
  const problems = [];

  if (advertised.length === 0) {
    problems.push(`${RENDERED_TOOLS} advertises no action kind, so every rule here is vacuous`);
    return problems;
  }
  if (names.length === 0) {
    problems.push(`${STEP_ACTIONS} reads no step argument, so every rule here is vacuous`);
    return problems;
  }

  for (const kind of advertised) {
    if (HANDED_OFF_KINDS.includes(kind) || runners.includes(kind)) continue;
    problems.push(
      `${STEP_ACTIONS} has no runner for "${kind}"` +
        `  - a confirmed card of that kind would report "not wired"`,
    );
  }
  for (const kind of runners) {
    if (advertised.includes(kind)) continue;
    problems.push(
      `${STEP_ACTIONS} runs "${kind}", which no action kind advertises` +
        `  - the registry in apps/api/src/features/agent/actions decides the kinds`,
    );
  }

  if (!source.includes("step.environment")) {
    problems.push(
      `${STEP_ACTIONS} never reads step.environment` +
        `  - a step acts in the environment its token binds, not one the model named`,
    );
  }

  const everyArgument = [
    ...new Set(
      advertised
        .filter((kind) => !HANDED_OFF_KINDS.includes(kind))
        .flatMap((kind) => kinds[kind])
        .filter((name) => !STEP_BOUND_ARGUMENTS.includes(name)),
    ),
  ].sort();
  for (const name of missing(everyArgument, names)) {
    const owners = advertised.filter((kind) => kinds[kind].includes(name));
    problems.push(
      `${STEP_ACTIONS} reads no "${name}" argument, which ${owners.join(", ")} advertises` +
        `  - a route body member reached the kind and not the request the browser sends`,
    );
  }
  const anyArgument = [...new Set(advertised.flatMap((kind) => kinds[kind]))];
  for (const name of missing(names, anyArgument)) {
    problems.push(
      `${STEP_ACTIONS} reads an "${name}" argument no kind advertises` +
        `  - the digest binds the arguments the card showed, so the step would be refused`,
    );
  }

  return problems;
}

export function checkAgentStepArgs() {
  return checkStepArguments(
    readFileSync(`${ROOT}${RENDERED_TOOLS}`, "utf8"),
    readFileSync(`${ROOT}${STEP_ACTIONS}`, "utf8"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkAgentStepArgs();
  if (problems.length > 0) {
    console.error("QCMS agent step argument check failed:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
  }
  const kinds = Object.keys(
    advertisedKinds(readFileSync(`${ROOT}${RENDERED_TOOLS}`, "utf8")),
  ).length;
  console.log(
    `QCMS agent step arguments: ${kinds} action kinds, every argument read by a runner in ` +
      `${STEP_ACTIONS}.`,
  );
}
