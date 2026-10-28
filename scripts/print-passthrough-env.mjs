#!/usr/bin/env node
/**
 * turbo runs tasks in strict env mode, so a variable the shell exported is withheld
 * unless `turbo.json` lists it, and the withholding is silent. The names are read from
 * `turbo.json` so a new knob is covered as soon as it is added.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A variable no `turbo.json` may ever list. Its ABSENCE is the control. */
export const CONTROL_VARIABLE = "QCMS_TURBO_STRICT_ENV_CONTROL";

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
