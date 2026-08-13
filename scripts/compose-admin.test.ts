import { describe, expect, it } from "vitest";

import { buildAdminExec, classifyBootstrap, generatePassword } from "./compose-admin.mjs";

/**
 * The one coupling in `compose-admin.mjs` that reaches into another module's prose,
 * pinned here so a reword fails a test rather than turning every refusal into an
 * error at the worst moment.
 *
 * These three sentences are copied verbatim from `describeRefusal` in
 * `apps/api/src/features/auth/bootstrap.ts`. They are not imported: that module
 * pulls in `@qcms/db`, drizzle and the better-auth instance, which is a large
 * runtime dependency for a tooling test to carry in order to read three strings.
 * The trade is stated rather than hidden - if that function is reworded, update
 * these fixtures, and the assertions below say what has to stay true.
 */
const REFUSALS = {
  alreadyBootstrapped:
    "Refusing: this deployment already has 1 admin account(s). The bootstrap command only runs against an empty admin table.",
  invalidEmail: "Refusing: QCMS_ADMIN_EMAIL is not a valid email address.",
  weakPassword: "Refusing: QCMS_ADMIN_PASSWORD must be at least 12 characters.",
};

describe("classifyBootstrap", () => {
  it("reads a clean exit as an account created", () => {
    expect(classifyBootstrap({ status: 0, stderr: "" })).toBe("created");
  });

  it("reads the already-bootstrapped refusal as a skip, which is what makes dev:up re-runnable", () => {
    expect(classifyBootstrap({ status: 1, stderr: REFUSALS.alreadyBootstrapped })).toBe(
      "already-bootstrapped",
    );
  });

  it("matches the refusal whatever the account count is", () => {
    expect(
      classifyBootstrap({
        status: 1,
        stderr: REFUSALS.alreadyBootstrapped.replace("1 admin", "14 admin"),
      }),
    ).toBe("already-bootstrapped");
  });

  // The reason the classification is not just "exit status 1". All three refusals
  // share that status, and reporting a rejected password as a successful skip is
  // the one misreading that would make dev:up lie about why sign-in fails.
  it("does not read a rejected password as a skip", () => {
    expect(classifyBootstrap({ status: 1, stderr: REFUSALS.weakPassword })).toBe("failed");
  });

  it("does not read a rejected email as a skip", () => {
    expect(classifyBootstrap({ status: 1, stderr: REFUSALS.invalidEmail })).toBe("failed");
  });

  it("treats a misconfiguration exit as a failure", () => {
    expect(
      classifyBootstrap({ status: 2, stderr: "Set QCMS_ADMIN_EMAIL and QCMS_ADMIN_PASSWORD" }),
    ).toBe("failed");
  });
});

describe("generatePassword", () => {
  it("clears the API's 12-character minimum with room to spare", () => {
    expect(generatePassword("dev-").length).toBeGreaterThan(30);
  });

  it("never starts with a character a shell reads as a flag", () => {
    // base64url may begin with "-", which is why every caller supplies a prefix.
    for (let attempt = 0; attempt < 200; attempt += 1)
      expect(generatePassword("dev-").startsWith("dev-")).toBe(true);
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword("e2e-")));
    expect(seen.size).toBe(50);
  });
});

/**
 * The control `create-admin.ts` documents, checked one process further up than that
 * file can check it (issue #440).
 *
 * `create-admin` never reads a credential from its own argv. That was true and it
 * was also not the whole path: the harness reached it through `docker compose exec
 * --env QCMS_ADMIN_PASSWORD=<value>`, which put the password in the **docker CLI's**
 * argv on the host, where `/proc/<pid>/cmdline` is world-readable. A comment is a
 * check that cannot fail, so the property is asserted here instead.
 *
 * Both halves are asserted together on purpose. "The password is not in argv" is
 * trivially satisfiable by not passing the password at all, and a refactor that did
 * that would break the bootstrap while leaving a green test behind; every case below
 * that looks for the absence is paired with one that finds the value where the
 * mechanism is supposed to deliver it.
 *
 * The password below is an obvious fixture literal and never a generated one, so
 * nothing real is ever in a test name or a failure diff (SEC-8).
 */
describe("buildAdminExec", () => {
  const CREDENTIALS = {
    email: "first.admin@example.test",
    password: "fixture-not-a-real-password",
  };
  const COMPOSE = ["compose", "--project-name", "qcms-fixture", "--file", "docker-compose.yml"];

  function build() {
    return buildAdminExec({
      compose: COMPOSE,
      credentials: CREDENTIALS,
      environment: { PATH: "/usr/bin", QCMS_PORT_SEAT: "5" },
    });
  }

  it("keeps the password out of the docker CLI's argv", () => {
    const { argv } = build();
    expect(argv.some((argument) => argument.includes(CREDENTIALS.password))).toBe(false);
  });

  it("still delivers the password, through the environment the docker CLI is given", () => {
    // The other half of the case above: absence in argv only counts as a fix if the
    // value is still arriving somewhere.
    expect(build().environment.QCMS_ADMIN_PASSWORD).toBe(CREDENTIALS.password);
  });

  it("names the variables on the command line with no value attached, which is what makes docker read them from its environment", () => {
    const { argv } = build();
    expect(argv).toContain("QCMS_ADMIN_PASSWORD");
    expect(argv).toContain("QCMS_ADMIN_EMAIL");
    expect(argv.some((argument) => argument.includes("QCMS_ADMIN_PASSWORD="))).toBe(false);
    expect(argv.some((argument) => argument.includes("QCMS_ADMIN_EMAIL="))).toBe(false);
  });

  it("keeps the email out of argv too, and passes it the same way", () => {
    const { argv, environment } = build();
    expect(argv.some((argument) => argument.includes(CREDENTIALS.email))).toBe(false);
    expect(environment.QCMS_ADMIN_EMAIL).toBe(CREDENTIALS.email);
  });

  it("leaves the environment it was handed intact", () => {
    // The credentials are added to the docker CLI's environment, not substituted for
    // it: that environment carries the seat's ports and the compose project's own
    // values, and an exec without them addresses a different stack.
    expect(build().environment).toMatchObject({ PATH: "/usr/bin", QCMS_PORT_SEAT: "5" });
  });

  it("execs the compiled entry in the api service, behind the caller's compose prefix", () => {
    const { argv } = build();
    expect(argv.slice(0, COMPOSE.length)).toEqual(COMPOSE);
    expect(argv[COMPOSE.length]).toBe("exec");
    expect(argv.slice(-3)).toEqual(["api", "node", "dist/create-admin.js"]);
  });
});
