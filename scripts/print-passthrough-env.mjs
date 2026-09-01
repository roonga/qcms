#!/usr/bin/env node
/**
 * Print, from inside a task turbo actually ran, what reached this process.
 *
 * The probe half of `scripts/turbo-passthrough-env.test.ts` (issue #154). turbo 2.x
 * runs tasks in strict env mode, so a variable exported by a CI job or a developer's
 * shell is withheld from the task unless `turbo.json` lists it. That withholding is
 * silent, and it cost weeks once: issue #74's GHCR mirror never applied to the
 * `verify` job, the pre-pull succeeded, and the harness asked Docker Hub for its
 * default image anyway while CI stayed green.
 *
 * The names are read from `turbo.json` rather than written out here, so a knob added
 * to `globalPassThroughEnv` is covered the moment it is added and cannot be forgotten
 * separately. The control name is a variable deliberately NOT in that list: it proves
 * strict mode is on, which is what makes every other line here mean something.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A variable no `turbo.json` may ever list. Its ABSENCE is the control. */
export const CONTROL_VARIABLE = "QCMS_TURBO_STRICT_ENV_CONTROL";

/** Marker prefix, so the reader can find these lines in turbo's prefixed output. */
export const ARRIVAL_PREFIX = "env-arrival";

const TURBO_JSON = fileURLToPath(new URL("../turbo.json", import.meta.url));

/** `turbo.json` carries `//` comments, which JSON.parse rejects. */
export function readGlobalPassThroughEnv(source = readFileSync(TURBO_JSON, "utf8")) {
  const withoutComments = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  const config = JSON.parse(withoutComments);
  return config.globalPassThroughEnv ?? [];
}

function main() {
  for (const name of [...readGlobalPassThroughEnv(), CONTROL_VARIABLE]) {
    const value = process.env[name];
    process.stdout.write(`${ARRIVAL_PREFIX} ${name}=${value === undefined ? "<unset>" : value}\n`);
  }
}

// Only when run as the task, so the test can import the two constants above.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
