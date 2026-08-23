// @ts-check
/**
 * Loading the sample question library into a running composed QCMS stack.
 *
 * `apps/api/scripts/seed-fixtures.ts` has existed since task 032 and the Questions
 * screen's own empty state tells a developer to run it, but nothing wired it to the
 * stack `pnpm dev:up` brings up: the loader takes a `DATABASE_URL` and that stack's
 * Postgres is deliberately unpublished, so there was no address to give it. This is
 * that wiring, and it is a sibling of `compose-admin.mjs` rather than a variation on
 * it - same stack, same "run a one-shot thing inside it" shape, same rule about
 * credentials and argv.
 *
 * Three pieces of knowledge live here so that neither caller has to hold them:
 *
 *   1. **The loader runs in a container on the Compose network**, from the image
 *      `docker/seed.Dockerfile` builds. Not from the host, because the database is
 *      unpublished and `scripts/compose-config.test.ts` asserts it stays that way;
 *      and not from a bind mount of the checkout, because ADR-29's dev container
 *      drives the host daemon, where the repository's path does not exist.
 *   2. **The database URL travels in the environment**, never in argv. Same control
 *      as `buildAdminExec` and the same reason (issue #440): `/proc/<pid>/cmdline`
 *      is world-readable on Linux, so a password in a docker CLI's arguments is
 *      readable by every account on the box for the lifetime of the call.
 *      `docker compose run --env NAME` with no `=value` is the documented
 *      pass-through form - the CLI looks the name up in its own environment and
 *      sends the value over the daemon socket.
 *   3. **Re-running is the normal case and not an error.** The loader skips a
 *      question that already exists, because an id is permanent (R6) and a re-run
 *      must never look like an attempt to reuse one. It reports what it skipped and
 *      exits zero, so unlike `create-admin` there is no refusal to classify here.
 *
 * Nothing here knows a project name, a Compose file list or a seat: the caller
 * passes the `compose ...` argv prefix it already built, exactly as
 * `compose-admin.mjs` does.
 */

import { spawnSync } from "node:child_process";

import { DOCKER, REPOSITORY_ROOT } from "./docker.mjs";

/**
 * The database URL the seeding container dials, composed from the same variables
 * Compose interpolates into the stack itself.
 *
 * `postgres:5432` is the service name on the Compose network, which is the whole
 * point of running the loader inside it: the host has no route to that database and
 * is not given one. The defaults match `docker-compose.yml`'s own, so a developer
 * who set none of these in `.env` gets the same answer Compose does.
 *
 * Pure and exported so `compose-seed.test.ts` can pin the shape without spawning
 * anything, and so the one place that assembles a credential is a place a reader can
 * find.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
export function databaseUrlFor(environment) {
  const user = environment.QCMS_DB_USER ?? "qcms";
  const password = environment.QCMS_DB_PASSWORD ?? "";
  const name = environment.QCMS_DB_NAME ?? "qcms";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${name}`;
}

/**
 * The docker argv and the docker environment for one seeding run.
 *
 * Split out and exported for the reason `buildAdminExec` is: the property worth
 * asserting is that no credential appears in any argv, and that is a test rather
 * than a comment.
 *
 * `run --rm` rather than `exec`: `exec` needs a service that is already running, and
 * this container is not part of the stack - it exists for the length of one load and
 * is removed. `--build` is passed because the image is profiled, so `up` has never
 * built it; Compose builds it on demand and reuses the layers afterwards.
 *
 * @param {object} options
 * @param {readonly string[]} options.compose the `compose --project-name ... --env-file ...` argv prefix.
 * @param {string} options.databaseUrl
 * @param {NodeJS.ProcessEnv} options.environment the environment the docker CLI runs in.
 * @returns {{ argv: string[]; environment: NodeJS.ProcessEnv }}
 */
export function buildSeedRun({ compose, databaseUrl, environment }) {
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
    ],
    environment: { ...environment, DATABASE_URL: databaseUrl },
  };
}

/**
 * Load the fixture library into the stack's database.
 *
 * Deliberately NOT built on `runProcess` from `docker.mjs`: that helper inherits the
 * parent's stdio, and the whole value of this command is the loader's own last line
 * ("Seeded 7 question(s); 0 already present."), which a developer should see whether
 * this returns or throws. Captured and written through, as `createFirstAdmin` does.
 *
 * @param {object} options
 * @param {readonly string[]} options.compose
 * @param {string} options.databaseUrl
 * @param {NodeJS.ProcessEnv} options.environment
 * @returns {void}
 */
export function seedFixtures({ compose, databaseUrl, environment }) {
  const run = buildSeedRun({ compose, databaseUrl, environment });
  const result = spawnSync(DOCKER, run.argv, {
    cwd: REPOSITORY_ROOT,
    env: run.environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0)
    throw new Error(
      `the seed container exited with status ${String(result.status ?? 1)}; ` +
        "its own message is above",
    );
}
