import { describe, expect, it } from "vitest";

import { classifyBootstrap, generatePassword } from "./compose-admin.mjs";

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
