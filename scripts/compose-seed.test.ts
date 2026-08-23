import { describe, expect, it } from "vitest";

import { buildSeedRun, databaseUrlFor } from "./compose-seed.mjs";

/**
 * What `pnpm dev:seed` sends to Docker, pinned where it can be read without running
 * anything.
 *
 * Two properties are worth a test rather than a comment, and the first is a security
 * control rather than a preference.
 */

const COMPOSE = [
  "compose",
  "--project-name",
  "qcms-local-stack",
  "--env-file",
  ".env",
  "--file",
  "docker-compose.yml",
  "--file",
  "docker-compose.dev-tools.yml",
];

const URL_WITH_SECRET = "postgres://qcms:s3cr3t-not-real@postgres:5432/qcms";

describe("databaseUrlFor", () => {
  it("dials the service name, because the host has no route to that database", () => {
    // The whole reason the loader runs in a container: `docker-compose.yml` publishes
    // no port for Postgres and `compose-config.test.ts` asserts it stays that way,
    // with the toolbox overlay layered on. `postgres:5432` is reachable only from
    // inside the Compose network.
    expect(
      databaseUrlFor({ QCMS_DB_USER: "qcms", QCMS_DB_PASSWORD: "pw", QCMS_DB_NAME: "qcms" }),
    ).toBe("postgres://qcms:pw@postgres:5432/qcms");
  });

  it("falls back to the same defaults docker-compose.yml uses", () => {
    // A developer who set only a password in `.env` gets the answer Compose would
    // have interpolated, rather than a second opinion about what the user and
    // database are called.
    expect(databaseUrlFor({ QCMS_DB_PASSWORD: "pw" })).toBe(
      "postgres://qcms:pw@postgres:5432/qcms",
    );
  });

  it("escapes a password that would otherwise not survive a URL", () => {
    // `openssl rand -base64` output contains `/` and `+`, and a `/` in the userinfo
    // ends the authority: unescaped, the connection silently targets a different
    // database rather than failing.
    expect(databaseUrlFor({ QCMS_DB_PASSWORD: "a/b+c@d" })).toBe(
      "postgres://qcms:a%2Fb%2Bc%40d@postgres:5432/qcms",
    );
  });
});

describe("buildSeedRun", () => {
  it("keeps the credential out of argv and puts it in the CLI's environment", () => {
    // ISSUE #440's CONTROL, and the reason this function is exported at all.
    // `/proc/<pid>/cmdline` is world-readable on Linux, so a URL carrying the
    // database password in the docker CLI's arguments is readable by every account
    // on the machine for the lifetime of the call. `--env NAME` with no `=value` is
    // Docker's pass-through form: the CLI resolves the name from its own environment
    // and sends the value over the daemon socket, and an environment is not
    // world-readable.
    const run = buildSeedRun({
      compose: COMPOSE,
      databaseUrl: URL_WITH_SECRET,
      environment: { PATH: "/usr/bin" },
    });

    expect(run.argv).toContain("DATABASE_URL");
    expect(run.argv.join(" "), "no argument carries the value").not.toContain("s3cr3t-not-real");
    expect(run.environment.DATABASE_URL).toBe(URL_WITH_SECRET);
    // The `--env` immediately before it is the pass-through flag, not a `KEY=value`.
    expect(run.argv[run.argv.indexOf("DATABASE_URL") - 1]).toBe("--env");
  });

  it("runs a throwaway container of the profiled service, building it on demand", () => {
    const run = buildSeedRun({
      compose: COMPOSE,
      databaseUrl: URL_WITH_SECRET,
      environment: {},
    });

    // `run` and not `exec`: `exec` needs a running service, and this one is profiled
    // precisely so that `up` never starts it. `--rm` because it exists for the length
    // of one load, and `--build` because a profiled service is never built by `up`.
    expect(run.argv.slice(0, COMPOSE.length)).toEqual(COMPOSE);
    expect(run.argv).toContain("run");
    expect(run.argv).not.toContain("exec");
    expect(run.argv).toContain("--rm");
    expect(run.argv).toContain("--build");
    expect(run.argv.at(-1), "the profiled service from the toolbox overlay").toBe("seed");
  });

  it("passes the caller's compose prefix through untouched", () => {
    // Stack identity - the project name, the file list, the env file - belongs to the
    // caller, exactly as it does for `buildAdminExec`. Nothing here knows a seat.
    const other = ["compose", "--project-name", "qcms-local-stack-s3"];
    const run = buildSeedRun({ compose: other, databaseUrl: URL_WITH_SECRET, environment: {} });
    expect(run.argv.slice(0, other.length)).toEqual(other);
  });
});
