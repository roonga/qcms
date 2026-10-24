// @ts-check
/**
 * The loader runs in a container on the Compose network because the stack's Postgres is
 * deliberately unpublished and the dev container drives the host daemon, where this
 * checkout's path does not exist.
 *
 * The database URL travels in the environment, never in argv: `/proc/<pid>/cmdline` is
 * world-readable on Linux. `clear` and `reset` go through this same door so that a
 * command which deletes data cannot reach any database but this stack's.
 */

import { spawnSync } from "node:child_process";

import { CommandFailed, DOCKER, REPOSITORY_ROOT } from "./docker.mjs";

/**
 * The password deliberately has no default, unlike the user and database: Compose
 * refuses to interpolate without it, so an empty default could only compose a URL that
 * cannot work and turn a missing credential into an authentication failure.
 */
export function databaseUrlFor(environment) {
  const user = environment.QCMS_DB_USER ?? "qcms";
  const password = environment.QCMS_DB_PASSWORD ?? "";
  const name = environment.QCMS_DB_NAME ?? "qcms";
  if (password === "")
    throw new Error(
      "QCMS_DB_PASSWORD is empty or unset, so there is no database URL to compose. " +
        "The composed stack requires it; set it in .env.",
    );
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${name}`;
}

/**
 * Only the mode travels in argv, and it is one of three literals: no credential may
 * ever appear there. It is appended after the service name, which is where Compose
 * passes arguments through to the image's entrypoint, so the container's own layout
 * stays out of this file.
 *
 * `run --rm` rather than `exec`, because this container is not part of the stack.
 */
export function buildSeedRun({ compose, databaseUrl, environment, mode = "seed" }) {
  if (mode !== "seed" && mode !== "clear" && mode !== "reset")
    throw new Error(`unknown seed mode "${mode}"; expected seed, clear or reset`);
  return {
    argv: [
      ...compose,
      "run",
      "--rm",
      "--build",
      "--no-TTY",
      // The name only. The value is four lines down, in the CLI's environment.
      "--env",
      "DATABASE_URL",
      "seed",
      mode,
    ],
    environment: { ...environment, DATABASE_URL: databaseUrl },
  };
}

/**
 * Not built on `runProcess`, which inherits stdio: the loader's own last lines are the
 * value of this command and must be shown whether it returns or throws.
 */
export function seedFixtures({ compose, databaseUrl, environment, mode = "seed" }) {
  const run = buildSeedRun({ compose, databaseUrl, environment, mode });
  const result = spawnSync(DOCKER, run.argv, {
    cwd: REPOSITORY_ROOT,
    env: run.environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  // `CommandFailed` so the caller prints one line: the container already wrote its own
  // explanation, which a Node stack trace would bury.
  if (result.status !== 0)
    throw new CommandFailed(`the ${mode} container (its own message is above)`, result.status ?? 1);
}
