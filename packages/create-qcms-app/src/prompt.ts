/**
 * The interactive half (task 037).
 *
 * `node:readline/promises` and nothing else. A prompt library would be a runtime
 * dependency in the one package an adopter runs before they have decided to trust us,
 * and the minimal-dependency policy is explicit that a dependency saving under a
 * hundred lines is a liability. This is under a hundred lines.
 *
 * Every prompt takes its default from `DEFAULTS`, so pressing Enter through the whole
 * sequence lands on exactly the tree `--yes` produces. That equivalence is asserted in
 * `prompt.test.ts`: a default that only exists on one of the two paths is a default
 * nobody tests.
 */

import { createInterface, type Interface } from "node:readline/promises";

import {
  DEFAULTS,
  DEPLOYMENT_SHAPES,
  PACKAGE_MANAGERS,
  TWO_FACTOR_POLICIES,
  normalizeBaseUrl,
  validateBaseUrl,
  validateProjectName,
  resolveTarget,
  type PartialOptions,
} from "./options.js";

/** The minimum of `readline`'s surface this module uses, so tests can supply their own. */
export interface Asker {
  question(prompt: string): Promise<string>;
  close(): void;
}

/** A readline interface over stdin and stdout. */
export function stdioAsker(): Asker {
  const rl: Interface = createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: (prompt) => rl.question(prompt),
    close: () => {
      rl.close();
    },
  };
}

/** Ask until the answer validates, offering `fallback` for an empty response. */
async function askText(
  asker: Asker,
  label: string,
  fallback: string,
  validate: (value: string) => string | undefined,
): Promise<string> {
  for (;;) {
    const answer = (await asker.question(`${label} (${fallback}): `)).trim();
    const value = answer === "" ? fallback : answer;
    const problem = validate(value);
    if (problem === undefined) return value;
    process.stdout.write(`  ${problem}\n`);
  }
}

/** Ask until the answer is one of `choices`, offering `fallback` for an empty response. */
async function askChoice<T extends string>(
  asker: Asker,
  label: string,
  choices: readonly T[],
  fallback: T,
): Promise<T> {
  for (;;) {
    const answer = (await asker.question(`${label} [${choices.join("/")}] (${fallback}): `)).trim();
    if (answer === "") return fallback;
    const match = choices.find((choice) => choice === answer);
    if (match !== undefined) return match;
    process.stdout.write(`  Choose one of: ${choices.join(", ")}\n`);
  }
}

/**
 * Ask for everything the command line left open.
 *
 * Options already supplied by a flag are never asked about again, which is what makes
 * a half-flagged invocation (`create-qcms-app forms --shape enterprise`) behave the
 * way an operator expects rather than re-asking what they already said.
 */
export async function promptMissing(
  given: PartialOptions,
  asker: Asker,
  cwd: string,
): Promise<PartialOptions> {
  const answers: PartialOptions = { ...given };
  const filled: Record<string, unknown> = answers;

  if (given.projectName === undefined) {
    const projectName = await askText(asker, "Project name", DEFAULTS.projectName, (value) =>
      validateProjectName(value),
    );
    filled["projectName"] = projectName;
    filled["targetDirectory"] = resolveTarget(projectName, cwd);
  }
  if (given.packageManager === undefined) {
    filled["packageManager"] = await askChoice(
      asker,
      "Package manager",
      PACKAGE_MANAGERS,
      DEFAULTS.packageManager,
    );
  }
  if (given.shape === undefined) {
    filled["shape"] = await askChoice(asker, "Deployment shape", DEPLOYMENT_SHAPES, DEFAULTS.shape);
  }
  if (given.adminTwoFactor === undefined) {
    filled["adminTwoFactor"] = await askChoice(
      asker,
      "Admin two-factor authentication",
      TWO_FACTOR_POLICIES,
      DEFAULTS.adminTwoFactor,
    );
  }
  if (given.portalBaseUrl === undefined) {
    filled["portalBaseUrl"] = normalizeBaseUrl(
      await askText(asker, "Portal base URL", DEFAULTS.portalBaseUrl, (value) =>
        validateBaseUrl(value, "The portal base URL"),
      ),
    );
  }
  if (given.adminBaseUrl === undefined) {
    filled["adminBaseUrl"] = normalizeBaseUrl(
      await askText(asker, "Admin base URL", DEFAULTS.adminBaseUrl, (value) =>
        validateBaseUrl(value, "The admin base URL"),
      ),
    );
  }
  return answers;
}
