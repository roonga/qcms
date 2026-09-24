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

  it("refuses to compose a URL with no password rather than one that cannot work", () => {
    // `docker-compose.yml` requires `QCMS_DB_PASSWORD`, so an empty one matches no
    // running stack: defaulting it would turn a missing credential into an
    // authentication failure from inside a container, which is a much longer way round
    // to the same sentence.
    expect(() => databaseUrlFor({})).toThrow(/QCMS_DB_PASSWORD/u);
    expect(() => databaseUrlFor({ QCMS_DB_PASSWORD: "" })).toThrow(/QCMS_DB_PASSWORD/u);
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

describe("buildSeedRun modes (issue #994)", () => {
  it("defaults to seed, so the container's own entrypoint needs no argument", () => {
    const run = buildSeedRun({ compose: COMPOSE, databaseUrl: URL_WITH_SECRET, environment: {} });
    expect(run.argv.slice(-2)).toEqual(["seed", "seed"]);
  });

  it("appends the subcommand after the service name, where Compose passes it through", () => {
    // `docker compose run SERVICE ARGS...` replaces the image's CMD and leaves its
    // ENTRYPOINT alone, so the loader's path stays in `docker/seed.Dockerfile` and
    // this file never names a path inside the image (issue #817's lesson).
    for (const mode of ["seed", "clear", "reset"] as const) {
      const run = buildSeedRun({
        compose: COMPOSE,
        databaseUrl: URL_WITH_SECRET,
        environment: {},
        mode,
      });
      expect(run.argv.at(-2)).toBe("seed");
      expect(run.argv.at(-1)).toBe(mode);
      expect(run.argv.join(" ")).not.toContain("/app/seed");
    }
  });

  it("keeps the credential out of argv on the destructive modes too", () => {
    // The #440 control is not a property of the loading path: a `clear` run assembles
    // the same URL and must put it in the same place.
    for (const mode of ["clear", "reset"] as const) {
      const run = buildSeedRun({
        compose: COMPOSE,
        databaseUrl: URL_WITH_SECRET,
        environment: { PATH: "/usr/bin" },
        mode,
      });
      expect(run.argv.join(" ")).not.toContain("s3cr3t-not-real");
      expect(run.environment.DATABASE_URL).toBe(URL_WITH_SECRET);
    }
  });

  it("refuses a mode it does not know rather than passing it to the container", () => {
    // The container would reject it too, but only after a build and a boot; and an
    // argv this file did not vet is an argv it cannot claim anything about.
    expect(() =>
      buildSeedRun({
        compose: COMPOSE,
        databaseUrl: URL_WITH_SECRET,
        environment: {},
        // @ts-expect-error - the point of the test is the runtime guard.
        mode: "drop",
      }),
    ).toThrow(/unknown seed mode/u);
  });
});
