import { describe, expect, it } from "vitest";

import { buildSeedRun, databaseUrlFor } from "./compose-seed.mjs";

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
    // `postgres:5432` is reachable only from inside the Compose network, which is why
    // the loader runs in a container at all.
    expect(
      databaseUrlFor({ QCMS_DB_USER: "qcms", QCMS_DB_PASSWORD: "pw", QCMS_DB_NAME: "qcms" }),
    ).toBe("postgres://qcms:pw@postgres:5432/qcms");
  });

  it("falls back to the same defaults docker-compose.yml uses", () => {
    expect(databaseUrlFor({ QCMS_DB_PASSWORD: "pw" })).toBe(
      "postgres://qcms:pw@postgres:5432/qcms",
    );
  });

  it("refuses to compose a URL with no password rather than one that cannot work", () => {
    // Defaulting an empty password would turn a missing credential into an
    // authentication failure from inside a container.
    expect(() => databaseUrlFor({})).toThrow(/QCMS_DB_PASSWORD/u);
    expect(() => databaseUrlFor({ QCMS_DB_PASSWORD: "" })).toThrow(/QCMS_DB_PASSWORD/u);
  });

  it("escapes a password that would otherwise not survive a URL", () => {
    // An unescaped `/` in the userinfo ends the authority, so the connection silently
    // targets a different database rather than failing.
    expect(databaseUrlFor({ QCMS_DB_PASSWORD: "a/b+c@d" })).toBe(
      "postgres://qcms:a%2Fb%2Bc%40d@postgres:5432/qcms",
    );
  });
});

describe("buildSeedRun", () => {
  it("keeps the credential out of argv and puts it in the CLI's environment", () => {
    // `/proc/<pid>/cmdline` is world-readable, so a password in the docker CLI's argv is
    // readable by every account on the machine. `--env NAME` passes it through instead.
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

    expect(run.argv.slice(0, COMPOSE.length)).toEqual(COMPOSE);
    expect(run.argv).toContain("run");
    expect(run.argv).not.toContain("exec");
    expect(run.argv).toContain("--rm");
    expect(run.argv).toContain("--build");
    expect(run.argv.at(-1), "the profiled service from the toolbox overlay").toBe("seed");
  });

  it("passes the caller's compose prefix through untouched", () => {
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
