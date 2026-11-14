import { describe, expect, it } from "vitest";

import { buildAdminExec, classifyBootstrap, generatePassword } from "./compose-admin.mjs";

/**
 * Copied verbatim from `describeRefusal` in `apps/api/src/features/auth/bootstrap.ts`
 * rather than imported, because importing it would pull in the database and better-auth.
 * Reword that function and these fixtures have to move with it.
 */
const REFUSALS = {
  alreadyBootstrapped:
    "Refusing: this deployment already has 1 Site administrator(s). The bootstrap command only runs on a deployment with none.",
  invalidEmail: "Refusing: QCMS_ADMIN_EMAIL is not a valid email address.",
  weakPassword: "Refusing: QCMS_ADMIN_PASSWORD must be at least 12 characters.",
};

describe("classifyBootstrap", () => {
  it("reads a clean exit as an account created", () => {
    expect(classifyBootstrap({ status: 0, stderr: "" })).toBe("created");
  });

  it("reads a promoted existing account apart from a created one, since its password is unchanged", () => {
    expect(
      classifyBootstrap({
        status: 0,
        stdout:
          'Promoted the existing account for dev@qcms.test to Site administrator.\nThis account owns the workspace "main".\n',
        stderr: "",
      }),
    ).toBe("promoted");
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
        stderr: REFUSALS.alreadyBootstrapped.replace("1 Site", "14 Site"),
      }),
    ).toBe("already-bootstrapped");
  });

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
    for (let attempt = 0; attempt < 200; attempt += 1)
      expect(generatePassword("dev-").startsWith("dev-")).toBe(true);
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword("e2e-")));
    expect(seen.size).toBe(50);
  });
});

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
    // Added to the docker CLI's environment, not substituted for it: without the seat's
    // ports and project values an exec addresses a different stack.
    expect(build().environment).toMatchObject({ PATH: "/usr/bin", QCMS_PORT_SEAT: "5" });
  });

  it("execs the compiled entry in the api service, behind the caller's compose prefix", () => {
    const { argv } = build();
    expect(argv.slice(0, COMPOSE.length)).toEqual(COMPOSE);
    expect(argv[COMPOSE.length]).toBe("exec");
    expect(argv.slice(-3)).toEqual(["api", "node", "dist/create-admin.js"]);
  });
});
