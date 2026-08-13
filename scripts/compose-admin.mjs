// @ts-check
/**
 * Creating the FIRST administrator inside a running composed QCMS stack.
 *
 * Two harnesses need this and they need it identically: the full-stack browser
 * harness (`compose-e2e.mjs`, which bootstraps a throwaway stack per run) and the
 * developer stack (`dev-compose.mjs`, behind `pnpm dev:up`). What they share is not
 * a convenience, it is four pieces of knowledge that are wrong in the same way if
 * either copy drifts:
 *
 *   1. **The account is created through the `api` service.** Since task 056 the API
 *      owns better-auth and is the only container holding a database credential
 *      (ADR-35 as amended 2026-07-31), so it is the only container that CAN create
 *      an account. Running this against the seat's `pnpm dev:portal` database
 *      instead - a different Postgres entirely - produces an admin in the wrong
 *      database and a sign-in that fails for reasons that look nothing like the
 *      cause.
 *   2. **The entry is the compiled `dist/create-admin.js`.** The image is built by
 *      `pnpm deploy --prod`, which ships only what the package's `files` field
 *      lists, so there is no `scripts/` and no TypeScript in there.
 *   3. **The credentials travel in the environment** all the way down, because
 *      `create-admin` reads them from there and from nowhere else
 *      (`apps/api/src/create-admin.ts`) and because nothing on the host should be
 *      able to read them out of a `ps` listing on the way (issue #440). The docker
 *      CLI's argv names the variables and carries no values; the values are in the
 *      environment the CLI itself is given. `buildAdminExec` is where that split
 *      lives, and `compose-admin.test.ts` pins it.
 *   4. **A refusal is not a failure.** `createInitialAdmin` closes the door the
 *      moment one account exists (SEC-1), and that refusal is the correct answer to
 *      a second run rather than something to work around. Reading it is what makes
 *      `pnpm dev:up` idempotent.
 *
 * Nothing here knows a project name, a Compose file list or a seat: the caller
 * passes the `compose ...` argv prefix it already built, exactly as
 * `scripts/docker.mjs` keeps stack identity out of the Docker plumbing.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { DOCKER, REPOSITORY_ROOT } from "./docker.mjs";

/**
 * How `create-admin` says an account already exists.
 *
 * This is a **deliberate coupling to another module's prose**, so it is written
 * down rather than buried: the string comes from `describeRefusal`'s
 * `already-bootstrapped` case in `apps/api/src/features/auth/bootstrap.ts`, and the
 * command has no machine-readable channel for it (exit code 1 covers all three
 * refusal kinds: already bootstrapped, invalid email, weak password). Widening the
 * match to "exit 1" would report a rejected password as a successful skip, which is
 * the one misreading that would make `pnpm dev:up` lie about why sign-in fails.
 *
 * `compose-admin.test.ts` pins the pattern against the exact sentence that function
 * produces, so a reword fails a test here instead of silently turning every refusal
 * into an error.
 */
const ALREADY_BOOTSTRAPPED = /refusing: this deployment already has \d+ admin account/i;

/**
 * A generated password for a local-only administrator.
 *
 * 24 random bytes as base64url is 32 characters, comfortably over the API's
 * `MIN_PASSWORD_LENGTH`. The caller supplies the prefix and every caller supplies
 * one, for a reason worth a line: base64url may begin with `-`, and a credential a
 * human copies into a terminal should not open with something a shell reads as a
 * flag.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function generatePassword(prefix) {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

/**
 * Classify what `create-admin` did, from its exit status and its own output.
 *
 * Pure, and exported, so the decision that makes `pnpm dev:up` idempotent is a test
 * rather than a comment.
 *
 * @param {{ status: number; stderr: string }} result
 * @returns {"created" | "already-bootstrapped" | "failed"}
 */
export function classifyBootstrap({ status, stderr }) {
  if (status === 0) return "created";
  if (ALREADY_BOOTSTRAPPED.test(stderr)) return "already-bootstrapped";
  return "failed";
}

/**
 * The docker argv and the docker environment for one bootstrap exec.
 *
 * Split out and exported so the property that matters here is a **test** rather
 * than a comment (issue #440): a credential must not appear in any process's argv,
 * on the host any more than in the container.
 *
 * `--env NAME=value` was the obvious form and it was the wrong one. `create-admin`
 * never sees the value as an argument, which is the control its docstring claims,
 * but one process up the docker CLI does: `/proc/<pid>/cmdline` is world-readable
 * on Linux, so for the lifetime of the exec any account on the box could read the
 * password out of a `ps` listing. `--env NAME` with **no** `=value` is docker's
 * documented pass-through form: the CLI looks the name up in its own environment
 * and sends the value over the daemon socket. An environment is not world-readable
 * (`/proc/<pid>/environ` is owner-and-root), so the value stops being visible to
 * every other user on the host.
 *
 * `--env-file` was the other candidate the issue named. `docker compose exec` has
 * no such flag (only `run` does), and taking it would have meant writing a live
 * credential to disk, chasing the create-time mode, and unlinking it in a `finally`
 * so a throw could not strand it. The pass-through form needs none of that, so it
 * is the one taken.
 *
 * Pure: no process is spawned here, which is what lets a unit test read the argv.
 *
 * @param {object} options
 * @param {readonly string[]} options.compose the `compose --project-name ... --env-file ...` argv prefix.
 * @param {{ email: string; password: string }} options.credentials
 * @param {NodeJS.ProcessEnv} options.environment the environment the docker CLI runs in.
 * @returns {{ argv: string[]; environment: NodeJS.ProcessEnv }}
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
 * Run `create-admin` in the stack's `api` container.
 *
 * Deliberately NOT built on `runProcess`/`captureProcess` from `docker.mjs`: both
 * treat a non-zero exit as a failure to throw on, and here one specific non-zero
 * exit is an expected, meaningful answer. The command's own stdout and stderr are
 * written through in every case, so whatever it said is on screen whether this
 * returns or throws.
 *
 * A docker CLI that dropped the pass-through variables rather than resolving them
 * would not fail quietly: `create-admin` exits 2 with "Set QCMS_ADMIN_EMAIL and
 * QCMS_ADMIN_PASSWORD in the environment", which `classifyBootstrap` reads as a
 * failure and this function throws on.
 *
 * @param {object} options
 * @param {readonly string[]} options.compose the `compose --project-name ... --env-file ...` argv prefix.
 * @param {{ email: string; password: string }} options.credentials
 * @param {NodeJS.ProcessEnv} options.environment the environment the docker CLI runs in.
 * @returns {"created" | "already-bootstrapped"}
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
