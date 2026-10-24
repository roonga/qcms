// @ts-check
/**
 * The account is created through the `api` service because that is the only container
 * holding a database credential (ADR-35). The credentials travel in the environment,
 * never in argv: nothing on the host should be able to read them out of a `ps` listing.
 *
 * A refusal once an account exists (SEC-1) is the correct answer to a second run, and
 * reading it rather than failing is what makes the bootstrap idempotent.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { DOCKER, REPOSITORY_ROOT } from "./docker.mjs";

/**
 * A deliberate coupling to the prose of `describeRefusal` in
 * `apps/api/src/features/auth/bootstrap.ts`, since exit 1 covers all three refusal
 * kinds. Matching on the status alone would read a rejected password as a skip.
 */
const ALREADY_BOOTSTRAPPED = /refusing: this deployment already has \d+ admin account/i;

/**
 * The prefix is required because base64url may begin with `-`, and a credential a
 * human pastes into a terminal must not open with something a shell reads as a flag.
 */
export function generatePassword(prefix) {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

export function classifyBootstrap({ status, stderr }) {
  if (status === 0) return "created";
  if (ALREADY_BOOTSTRAPPED.test(stderr)) return "already-bootstrapped";
  return "failed";
}

/**
 * `--env NAME` with no `=value` is docker's pass-through form: the CLI reads the name
 * from its own environment and sends the value over the daemon socket. `--env
 * NAME=value` would put the password in the CLI's own argv, and `/proc/<pid>/cmdline`
 * is world-readable on Linux while `/proc/<pid>/environ` is not.
 */
export function buildAdminExec({ compose, credentials, environment }) {
  return {
    argv: [
      ...compose,
      "exec",
      "--no-TTY",
      // Names only. The values are two lines down, in the CLI's environment.
      "--env",
      "QCMS_ADMIN_EMAIL",
      "--env",
      "QCMS_ADMIN_PASSWORD",
      "api",
      "node",
      "dist/create-admin.js",
    ],
    environment: {
      ...environment,
      QCMS_ADMIN_EMAIL: credentials.email,
      QCMS_ADMIN_PASSWORD: credentials.password,
    },
  };
}

/**
 * Not built on the `docker.mjs` helpers: both throw on a non-zero exit, and here one
 * specific non-zero exit is an expected answer.
 */
export function createFirstAdmin({ compose, credentials, environment }) {
  const exec = buildAdminExec({ compose, credentials, environment });
  const result = spawnSync(DOCKER, exec.argv, {
    cwd: REPOSITORY_ROOT,
    env: exec.environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  const outcome = classifyBootstrap({ status: result.status ?? 1, stderr });
  if (outcome === "failed")
    throw new Error(
      `create-admin exited with status ${String(result.status ?? 1)} in the api container; ` +
        "its own message is above",
    );
  return outcome;
}
